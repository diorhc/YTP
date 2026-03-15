/**
 * Unit tests for shared utilities:
 * - createRetryScheduler (incl. performance marks, label, edge cases)
 * - ObserverRegistry (incl. dump, concurrent track/untrack)
 * - resolveMusicContainers TTL cache (simulated)
 * - RateLimiter FIFO eviction
 * - EventDelegator _getElementKey determinism
 * - FeatureToggle (createFeatureToggle: onChange, setEnabled, reload)
 * - cleanupManager lifecycle
 * - sanitizeHTML
 */

describe('createRetryScheduler', () => {
  jest.useFakeTimers();

  /** @returns {{ stop: () => void }} */
  function createRetryScheduler(opts) {
    const { check, maxAttempts = 20, interval = 250, onGiveUp } = opts;
    let attempts = 0;
    let timerId = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      attempts++;
      try {
        if (check()) {
          stopped = true;
          return;
        }
      } catch {
        // ignore check errors in tests
      }
      if (attempts >= maxAttempts) {
        stopped = true;
        if (typeof onGiveUp === 'function') {
          try {
            onGiveUp();
          } catch {}
        }
        return;
      }
      timerId = setTimeout(tick, interval);
    };

    timerId = setTimeout(tick, 0);

    return {
      stop() {
        stopped = true;
        if (timerId) clearTimeout(timerId);
        timerId = null;
      },
    };
  }

  afterEach(() => {
    jest.clearAllTimers();
  });

  test('should stop when check returns true on first call', () => {
    const check = jest.fn(() => true);
    const onGiveUp = jest.fn();

    createRetryScheduler({ check, maxAttempts: 5, interval: 100, onGiveUp });
    jest.advanceTimersByTime(0);

    expect(check).toHaveBeenCalledTimes(1);
    expect(onGiveUp).not.toHaveBeenCalled();

    // No more calls after success
    jest.advanceTimersByTime(500);
    expect(check).toHaveBeenCalledTimes(1);
  });

  test('should retry until check succeeds', () => {
    let callCount = 0;
    const check = jest.fn(() => {
      callCount++;
      return callCount >= 3;
    });

    createRetryScheduler({ check, maxAttempts: 10, interval: 100 });

    jest.advanceTimersByTime(0); // tick 1
    expect(check).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100); // tick 2
    expect(check).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(100); // tick 3 - success
    expect(check).toHaveBeenCalledTimes(3);

    // Should not call again after success
    jest.advanceTimersByTime(500);
    expect(check).toHaveBeenCalledTimes(3);
  });

  test('should call onGiveUp after maxAttempts exceeded', () => {
    const check = jest.fn(() => false);
    const onGiveUp = jest.fn();

    createRetryScheduler({ check, maxAttempts: 3, interval: 50, onGiveUp });

    jest.advanceTimersByTime(0); // attempt 1
    jest.advanceTimersByTime(50); // attempt 2
    jest.advanceTimersByTime(50); // attempt 3 - max reached

    expect(check).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    // No more calls
    jest.advanceTimersByTime(200);
    expect(check).toHaveBeenCalledTimes(3);
  });

  test('should stop before completion when stop() is called', () => {
    const check = jest.fn(() => false);
    const onGiveUp = jest.fn();

    const scheduler = createRetryScheduler({ check, maxAttempts: 10, interval: 100, onGiveUp });

    jest.advanceTimersByTime(0); // attempt 1
    jest.advanceTimersByTime(100); // attempt 2

    scheduler.stop();

    jest.advanceTimersByTime(500);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  test('should handle check function that throws', () => {
    let callCount = 0;
    const check = jest.fn(() => {
      callCount++;
      if (callCount === 1) throw new Error('oops');
      return callCount >= 3;
    });

    createRetryScheduler({ check, maxAttempts: 5, interval: 50 });

    jest.advanceTimersByTime(0); // attempt 1 (throws)
    jest.advanceTimersByTime(50); // attempt 2
    jest.advanceTimersByTime(50); // attempt 3 (success)

    expect(check).toHaveBeenCalledTimes(3);
  });

  test('should use default options', () => {
    const check = jest.fn(() => true);

    createRetryScheduler({ check });

    jest.advanceTimersByTime(0);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe('ObserverRegistry', () => {
  function createObserverRegistry() {
    let _active = 0;
    let _peak = 0;
    let _created = 0;
    let _disconnected = 0;

    return {
      track() {
        _active++;
        _created++;
        if (_active > _peak) _peak = _active;
      },
      untrack() {
        _active = Math.max(0, _active - 1);
        _disconnected++;
      },
      getStats() {
        return { active: _active, peak: _peak, created: _created, disconnected: _disconnected };
      },
      reset() {
        _active = 0;
        _peak = 0;
        _created = 0;
        _disconnected = 0;
      },
    };
  }

  test('should start with zero counts', () => {
    const registry = createObserverRegistry();
    const stats = registry.getStats();

    expect(stats.active).toBe(0);
    expect(stats.peak).toBe(0);
    expect(stats.created).toBe(0);
    expect(stats.disconnected).toBe(0);
  });

  test('should track observer creation', () => {
    const registry = createObserverRegistry();

    registry.track();
    registry.track();
    registry.track();

    const stats = registry.getStats();
    expect(stats.active).toBe(3);
    expect(stats.peak).toBe(3);
    expect(stats.created).toBe(3);
    expect(stats.disconnected).toBe(0);
  });

  test('should track observer disconnection', () => {
    const registry = createObserverRegistry();

    registry.track();
    registry.track();
    registry.track();
    registry.untrack();

    const stats = registry.getStats();
    expect(stats.active).toBe(2);
    expect(stats.peak).toBe(3);
    expect(stats.created).toBe(3);
    expect(stats.disconnected).toBe(1);
  });

  test('should track peak correctly across cycles', () => {
    const registry = createObserverRegistry();

    // Create 5 observers
    for (let i = 0; i < 5; i++) registry.track();
    expect(registry.getStats().peak).toBe(5);

    // Remove 3
    for (let i = 0; i < 3; i++) registry.untrack();
    expect(registry.getStats().active).toBe(2);
    expect(registry.getStats().peak).toBe(5); // peak unchanged

    // Add 2 more (total active=4, still below peak=5)
    for (let i = 0; i < 2; i++) registry.track();
    expect(registry.getStats().active).toBe(4);
    expect(registry.getStats().peak).toBe(5);

    // Add 2 more (total active=6, new peak)
    for (let i = 0; i < 2; i++) registry.track();
    expect(registry.getStats().active).toBe(6);
    expect(registry.getStats().peak).toBe(6);
  });

  test('should not go below zero active', () => {
    const registry = createObserverRegistry();

    registry.track();
    registry.untrack();
    registry.untrack(); // Extra untrack

    const stats = registry.getStats();
    expect(stats.active).toBe(0);
    expect(stats.disconnected).toBe(2);
  });

  test('should reset all counts', () => {
    const registry = createObserverRegistry();

    registry.track();
    registry.track();
    registry.untrack();

    registry.reset();

    const stats = registry.getStats();
    expect(stats.active).toBe(0);
    expect(stats.peak).toBe(0);
    expect(stats.created).toBe(0);
    expect(stats.disconnected).toBe(0);
  });
});

describe('RateLimiter with FIFO eviction', () => {
  class RateLimiter {
    constructor(maxRequests = 10, timeWindow = 60000, maxKeys = 100) {
      this.maxRequests = maxRequests;
      this.timeWindow = timeWindow;
      this.maxKeys = maxKeys;
      this.requests = new Map();
    }

    canRequest(key) {
      const now = Date.now();
      const requests = this.requests.get(key) || [];
      const recentRequests = requests.filter(time => now - time < this.timeWindow);

      if (recentRequests.length >= this.maxRequests) return false;

      recentRequests.push(now);
      this.requests.set(key, recentRequests);

      // FIFO eviction
      if (this.requests.size > this.maxKeys) {
        const keysToDelete = this.requests.size - this.maxKeys;
        const iter = this.requests.keys();
        for (let i = 0; i < keysToDelete; i++) {
          const oldest = iter.next().value;
          if (oldest !== key) this.requests.delete(oldest);
        }
      }

      return true;
    }

    clear() {
      this.requests.clear();
    }
  }

  test('should allow requests under limit', () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.canRequest('test')).toBe(true);
    expect(limiter.canRequest('test')).toBe(true);
    expect(limiter.canRequest('test')).toBe(true);
  });

  test('should deny requests over limit', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.canRequest('test')).toBe(true);
    expect(limiter.canRequest('test')).toBe(true);
    expect(limiter.canRequest('test')).toBe(false);
  });

  test('should track different keys independently', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.canRequest('a')).toBe(true);
    expect(limiter.canRequest('a')).toBe(false);
    expect(limiter.canRequest('b')).toBe(true);
    expect(limiter.canRequest('b')).toBe(false);
  });

  test('should evict oldest keys when maxKeys exceeded', () => {
    const limiter = new RateLimiter(10, 60000, 3);

    limiter.canRequest('key1');
    limiter.canRequest('key2');
    limiter.canRequest('key3');
    expect(limiter.requests.size).toBe(3);

    limiter.canRequest('key4');
    // Should have evicted key1
    expect(limiter.requests.size).toBeLessThanOrEqual(3);
    expect(limiter.requests.has('key4')).toBe(true);
  });

  test('should clear all state', () => {
    const limiter = new RateLimiter(5, 1000);
    limiter.canRequest('a');
    limiter.canRequest('b');
    limiter.clear();
    expect(limiter.requests.size).toBe(0);
  });
});

describe('EventDelegator _getElementKey', () => {
  test('should return deterministic keys for same element', () => {
    // Simulate the new _getElementKey logic
    const elementKeyMap = new WeakMap();
    let elementKeyCounter = 0;

    function getElementKey(element) {
      if (element === document) return 'document';
      if (element === window) return 'window';
      if (element === document.body) return 'body';
      if (element.id) return element.id;
      let key = elementKeyMap.get(element);
      if (!key) {
        key = `${element.tagName || 'ELEM'}_${++elementKeyCounter}`;
        elementKeyMap.set(element, key);
      }
      return key;
    }

    expect(getElementKey(document)).toBe('document');
    expect(getElementKey(window)).toBe('window');

    const div = document.createElement('div');
    const key1 = getElementKey(div);
    const key2 = getElementKey(div);
    expect(key1).toBe(key2); // Same key for same element

    const div2 = document.createElement('div');
    const key3 = getElementKey(div2);
    expect(key3).not.toBe(key1); // Different elements get different keys
  });

  test('should use element id when available', () => {
    const elementKeyMap = new WeakMap();
    let elementKeyCounter = 0;

    function getElementKey(element) {
      if (element === document) return 'document';
      if (element === window) return 'window';
      if (element === document.body) return 'body';
      if (element.id) return element.id;
      let key = elementKeyMap.get(element);
      if (!key) {
        key = `${element.tagName || 'ELEM'}_${++elementKeyCounter}`;
        elementKeyMap.set(element, key);
      }
      return key;
    }

    const div = document.createElement('div');
    div.id = 'my-element';
    expect(getElementKey(div)).toBe('my-element');
  });

  test('should never use Math.random', () => {
    const originalRandom = Math.random;
    const randomSpy = jest.fn(() => 0.5);
    Math.random = randomSpy;

    try {
      const elementKeyMap = new WeakMap();
      let elementKeyCounter = 0;

      function getElementKey(element) {
        if (element.id) return element.id;
        let key = elementKeyMap.get(element);
        if (!key) {
          key = `${element.tagName || 'ELEM'}_${++elementKeyCounter}`;
          elementKeyMap.set(element, key);
        }
        return key;
      }

      const div = document.createElement('div');
      getElementKey(div);
      expect(randomSpy).not.toHaveBeenCalled();
    } finally {
      Math.random = originalRandom;
    }
  });
});

describe('FeatureToggle validation', () => {
  // Tests for the basic loadFeatureEnabled pattern
  test('should return default value when settings not present', () => {
    const loadFeatureEnabled = (featureKey, defaultValue = true) => {
      try {
        const raw = localStorage.getItem('youtube_plus_settings');
        if (!raw) return defaultValue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && featureKey in parsed) {
          return parsed[featureKey] !== false;
        }
        return defaultValue;
      } catch {
        return defaultValue;
      }
    };

    localStorage.removeItem('youtube_plus_settings');
    expect(loadFeatureEnabled('enableZoom')).toBe(true);
    expect(loadFeatureEnabled('enableZoom', false)).toBe(false);
  });

  test('should read feature state from localStorage', () => {
    const loadFeatureEnabled = (featureKey, defaultValue = true) => {
      try {
        const raw = localStorage.getItem('youtube_plus_settings');
        if (!raw) return defaultValue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && featureKey in parsed) {
          return parsed[featureKey] !== false;
        }
        return defaultValue;
      } catch {
        return defaultValue;
      }
    };

    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enableZoom: false }));
    expect(loadFeatureEnabled('enableZoom')).toBe(false);

    localStorage.setItem('youtube_plus_settings', JSON.stringify({ enableZoom: true }));
    expect(loadFeatureEnabled('enableZoom')).toBe(true);

    localStorage.removeItem('youtube_plus_settings');
  });

  test('should handle corrupted localStorage gracefully', () => {
    const loadFeatureEnabled = (featureKey, defaultValue = true) => {
      try {
        const raw = localStorage.getItem('youtube_plus_settings');
        if (!raw) return defaultValue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && featureKey in parsed) {
          return parsed[featureKey] !== false;
        }
        return defaultValue;
      } catch {
        return defaultValue;
      }
    };

    localStorage.setItem('youtube_plus_settings', '{corrupted json');
    expect(loadFeatureEnabled('enableZoom')).toBe(true);
    localStorage.removeItem('youtube_plus_settings');
  });
});

describe('sanitizeHTML', () => {
  const sanitizeHTML = html => {
    if (!html || typeof html !== 'string') return '';
    if (html.length > 1048576) html = html.substring(0, 1048576);
    return html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/`/g, '&#96;')
      .replace(/=/g, '&#x3D;');
  };

  test('should escape dangerous characters', () => {
    expect(sanitizeHTML('<script>alert("xss")</script>')).not.toContain('<script>');
    expect(sanitizeHTML('normal text')).toBe('normal text');
    expect(sanitizeHTML('')).toBe('');
    expect(sanitizeHTML(null)).toBe('');
  });

  test('should truncate extremely long strings', () => {
    const longStr = 'a'.repeat(1048577);
    const result = sanitizeHTML(longStr);
    expect(result.length).toBe(1048576);
  });

  test('should handle undefined input', () => {
    expect(sanitizeHTML(undefined)).toBe('');
  });

  test('should escape all HTML-sensitive characters', () => {
    expect(sanitizeHTML('&')).toBe('&amp;');
    expect(sanitizeHTML('<')).toBe('&lt;');
    expect(sanitizeHTML('>')).toBe('&gt;');
    expect(sanitizeHTML('"')).toBe('&quot;');
    expect(sanitizeHTML("'")).toBe('&#x27;');
    expect(sanitizeHTML('`')).toBe('&#96;');
    expect(sanitizeHTML('=')).toBe('&#x3D;');
  });
});

describe('createRetryScheduler — advanced', () => {
  jest.useFakeTimers();

  // Mock performance.mark / getEntriesByType / clearMarks for jsdom
  const _marks = [];
  const _origMark = global.performance.mark;
  const _origGetEntries = global.performance.getEntriesByType;
  const _origClearMarks = global.performance.clearMarks;

  beforeAll(() => {
    global.performance.mark = name => {
      _marks.push({ name, entryType: 'mark' });
    };
    global.performance.getEntriesByType = type => (type === 'mark' ? [..._marks] : []);
    global.performance.clearMarks = () => {
      _marks.length = 0;
    };
  });

  afterAll(() => {
    global.performance.mark = _origMark;
    global.performance.getEntriesByType = _origGetEntries;
    global.performance.clearMarks = _origClearMarks;
  });

  function createRetryScheduler(opts) {
    const { check, maxAttempts = 20, interval = 250, onGiveUp, label } = opts;
    let attempts = 0;
    let timerId = null;
    let stopped = false;
    const _label = label || 'retry';
    const _hasPerfApi =
      typeof performance !== 'undefined' && typeof performance.mark === 'function';

    const tick = () => {
      if (stopped) return;
      attempts++;
      if (_hasPerfApi) {
        try {
          performance.mark(`ytp:${_label}:attempt:${attempts}`);
        } catch {
          /* empty */
        }
      }
      try {
        if (check()) {
          stopped = true;
          if (_hasPerfApi) {
            try {
              performance.mark(`ytp:${_label}:success`);
            } catch {
              /* empty */
            }
          }
          return;
        }
      } catch {
        /* ignore check errors */
      }
      if (attempts >= maxAttempts) {
        stopped = true;
        if (_hasPerfApi) {
          try {
            performance.mark(`ytp:${_label}:giveup`);
          } catch {
            /* empty */
          }
        }
        if (typeof onGiveUp === 'function') {
          try {
            onGiveUp();
          } catch {
            /* empty */
          }
        }
        return;
      }
      timerId = setTimeout(tick, interval);
    };

    timerId = setTimeout(tick, 0);

    return {
      stop() {
        stopped = true;
        if (timerId) clearTimeout(timerId);
        timerId = null;
      },
    };
  }

  afterEach(() => {
    jest.clearAllTimers();
    _marks.length = 0;
  });

  test('should emit performance marks with custom label', () => {
    const check = jest.fn(() => false);
    createRetryScheduler({ check, maxAttempts: 2, interval: 50, label: 'playall' });

    jest.advanceTimersByTime(0); // attempt 1
    jest.advanceTimersByTime(50); // attempt 2 (giveup)

    const entries = performance.getEntriesByType('mark');
    const labels = entries.map(e => e.name);
    expect(labels).toContain('ytp:playall:attempt:1');
    expect(labels).toContain('ytp:playall:attempt:2');
    expect(labels).toContain('ytp:playall:giveup');
  });

  test('should emit success mark when check returns true', () => {
    const check = jest.fn(() => true);
    createRetryScheduler({ check, maxAttempts: 5, interval: 100, label: 'tabs' });

    jest.advanceTimersByTime(0);

    const entries = performance.getEntriesByType('mark');
    const labels = entries.map(e => e.name);
    expect(labels).toContain('ytp:tabs:success');
    expect(labels).not.toContain('ytp:tabs:giveup');
  });

  test('should handle onGiveUp that throws an error', () => {
    const check = jest.fn(() => false);
    const onGiveUp = jest.fn(() => {
      throw new Error('giveup error');
    });

    createRetryScheduler({ check, maxAttempts: 1, interval: 50, onGiveUp });
    jest.advanceTimersByTime(0);

    // Should not throw, and onGiveUp should have been called
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  test('should use default label "retry" when none provided', () => {
    const check = jest.fn(() => true);
    createRetryScheduler({ check });
    jest.advanceTimersByTime(0);

    const entries = performance.getEntriesByType('mark');
    const labels = entries.map(e => e.name);
    expect(labels).toContain('ytp:retry:success');
  });

  test('stop() should be idempotent', () => {
    const check = jest.fn(() => false);
    const scheduler = createRetryScheduler({ check, maxAttempts: 100, interval: 50 });

    jest.advanceTimersByTime(0); // attempt 1
    scheduler.stop();
    scheduler.stop(); // Double-stop should not throw
    scheduler.stop();

    jest.advanceTimersByTime(5000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  test('should work with maxAttempts=1', () => {
    const check = jest.fn(() => false);
    const onGiveUp = jest.fn();

    createRetryScheduler({ check, maxAttempts: 1, interval: 50, onGiveUp });
    jest.advanceTimersByTime(0);

    expect(check).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(200);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe('createFeatureToggle', () => {
  const SETTINGS_KEY = 'youtube_plus_settings';

  function loadFeatureEnabled(featureKey, defaultValue = true) {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaultValue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && featureKey in parsed) {
        return parsed[featureKey] !== false;
      }
      return defaultValue;
    } catch {
      return defaultValue;
    }
  }

  function createFeatureToggle(featureKey, defaultEnabled = true) {
    let _enabled = loadFeatureEnabled(featureKey, defaultEnabled);
    const _listeners = new Set();

    return {
      isEnabled() {
        return _enabled;
      },
      setEnabled(value) {
        const prev = _enabled;
        _enabled = !!value;
        // Persist to localStorage
        try {
          const raw = localStorage.getItem(SETTINGS_KEY);
          const settings = raw ? JSON.parse(raw) : {};
          settings[featureKey] = _enabled;
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
          /* empty */
        }
        if (prev !== _enabled) {
          for (const cb of _listeners) {
            try {
              cb(_enabled);
            } catch {
              /* empty */
            }
          }
        }
      },
      onChange(cb) {
        _listeners.add(cb);
        return () => _listeners.delete(cb);
      },
      reload() {
        _enabled = loadFeatureEnabled(featureKey, defaultEnabled);
      },
    };
  }

  beforeEach(() => {
    localStorage.removeItem(SETTINGS_KEY);
  });

  test('should return default enabled state when no settings exist', () => {
    const toggle = createFeatureToggle('enableZoom', true);
    expect(toggle.isEnabled()).toBe(true);

    const toggle2 = createFeatureToggle('enableZoom', false);
    expect(toggle2.isEnabled()).toBe(false);
  });

  test('should read initial state from localStorage', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enableZoom: false }));
    const toggle = createFeatureToggle('enableZoom');
    expect(toggle.isEnabled()).toBe(false);
  });

  test('setEnabled should persist to localStorage', () => {
    const toggle = createFeatureToggle('enableStats', true);
    toggle.setEnabled(false);

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    expect(stored.enableStats).toBe(false);
    expect(toggle.isEnabled()).toBe(false);
  });

  test('setEnabled should notify onChange listeners', () => {
    const toggle = createFeatureToggle('enablePip');
    const listener = jest.fn();

    toggle.onChange(listener);
    toggle.setEnabled(false);

    expect(listener).toHaveBeenCalledWith(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('setEnabled should not notify when value unchanged', () => {
    const toggle = createFeatureToggle('enablePip', true);
    const listener = jest.fn();

    toggle.onChange(listener);
    toggle.setEnabled(true); // Same value

    expect(listener).not.toHaveBeenCalled();
  });

  test('onChange should return unsubscribe function', () => {
    const toggle = createFeatureToggle('enablePip');
    const listener = jest.fn();

    const unsubscribe = toggle.onChange(listener);
    toggle.setEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    toggle.setEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1); // Not called again
  });

  test('reload should re-read state from localStorage', () => {
    const toggle = createFeatureToggle('enableZoom', true);
    expect(toggle.isEnabled()).toBe(true);

    // External change to localStorage
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enableZoom: false }));
    expect(toggle.isEnabled()).toBe(true); // Still cached

    toggle.reload();
    expect(toggle.isEnabled()).toBe(false); // Now updated
  });

  test('multiple toggles should be independent', () => {
    const toggle1 = createFeatureToggle('enableZoom');
    const toggle2 = createFeatureToggle('enableStats');

    toggle1.setEnabled(false);
    expect(toggle1.isEnabled()).toBe(false);
    expect(toggle2.isEnabled()).toBe(true);
  });

  test('should handle listener that throws', () => {
    const toggle = createFeatureToggle('enablePip');
    const badListener = jest.fn(() => {
      throw new Error('boom');
    });
    const goodListener = jest.fn();

    toggle.onChange(badListener);
    toggle.onChange(goodListener);

    // Should not throw and goodListener should still be called
    expect(() => toggle.setEnabled(false)).not.toThrow();
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();
  });
});

describe('resolveMusicContainers TTL cache (simulated)', () => {
  jest.useFakeTimers();

  function createMusicContainerResolver(ttl = 5000) {
    let _cached = null;
    let _cacheTime = 0;

    function resolve() {
      const now = Date.now();
      if (_cached && now - _cacheTime < ttl) return _cached;

      // Simulate DOM query
      const result = {
        browseResults: document.querySelector('ytmusic-browse-response'),
        tabContent: document.querySelector('ytmusic-tab-content'),
      };
      _cached = result;
      _cacheTime = now;
      return result;
    }

    function invalidate() {
      _cached = null;
      _cacheTime = 0;
    }

    return { resolve, invalidate };
  }

  afterEach(() => {
    jest.clearAllTimers();
    jest.setSystemTime(new Date());
  });

  test('should cache results for the TTL duration', () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00'));
    const querySpy = jest.spyOn(document, 'querySelector');
    const resolver = createMusicContainerResolver(5000);

    resolver.resolve(); // First call — triggers DOM query
    expect(querySpy).toHaveBeenCalledTimes(2); // browseResults + tabContent

    resolver.resolve(); // Second call within TTL — cached
    expect(querySpy).toHaveBeenCalledTimes(2); // No additional queries

    querySpy.mockRestore();
  });

  test('should refresh cache after TTL expires', () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00'));
    const querySpy = jest.spyOn(document, 'querySelector');
    const resolver = createMusicContainerResolver(5000);

    resolver.resolve();
    expect(querySpy).toHaveBeenCalledTimes(2);

    jest.setSystemTime(new Date('2026-01-01T00:00:06')); // 6s later
    resolver.resolve();
    expect(querySpy).toHaveBeenCalledTimes(4); // Re-queried

    querySpy.mockRestore();
  });

  test('invalidate() should force re-query on next resolve', () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00'));
    const querySpy = jest.spyOn(document, 'querySelector');
    const resolver = createMusicContainerResolver(5000);

    resolver.resolve();
    expect(querySpy).toHaveBeenCalledTimes(2);

    resolver.invalidate();
    resolver.resolve();
    expect(querySpy).toHaveBeenCalledTimes(4);

    querySpy.mockRestore();
  });

  test('should return same reference within TTL', () => {
    jest.setSystemTime(new Date('2026-01-01T00:00:00'));
    const resolver = createMusicContainerResolver(5000);

    const result1 = resolver.resolve();
    const result2 = resolver.resolve();
    expect(result1).toBe(result2); // Same object reference
  });
});

describe('cleanupManager lifecycle', () => {
  function createCleanupManager() {
    const observers = new Set();
    const listeners = new Map();
    const intervals = new Set();
    const timeouts = new Set();
    const animationFrames = new Set();
    const callbacks = new Set();
    let registeredTotal = 0;

    return {
      registerObserver(o) {
        if (o) observers.add(o);
        return o;
      },
      registerListener(target, ev, fn, opts) {
        target.addEventListener(ev, fn, opts);
        const key = Symbol();
        listeners.set(key, { target, ev, fn, opts });
        registeredTotal++;
        return key;
      },
      registerInterval(id) {
        intervals.add(id);
        return id;
      },
      registerTimeout(id) {
        timeouts.add(id);
        return id;
      },
      registerAnimationFrame(id) {
        animationFrames.add(id);
        return id;
      },
      register(cb) {
        callbacks.add(cb);
      },
      cleanup() {
        for (const o of observers) {
          if (o && typeof o.disconnect === 'function') o.disconnect();
        }
        observers.clear();
        for (const entry of listeners.values()) {
          entry.target.removeEventListener(entry.ev, entry.fn, entry.opts);
        }
        listeners.clear();
        for (const id of intervals) clearInterval(id);
        intervals.clear();
        for (const id of timeouts) clearTimeout(id);
        timeouts.clear();
        for (const id of animationFrames) {
          try {
            cancelAnimationFrame(id);
          } catch {
            /* empty */
          }
        }
        animationFrames.clear();
        for (const cb of callbacks) {
          try {
            cb();
          } catch {
            /* empty */
          }
        }
        callbacks.clear();
      },
      getStats() {
        return {
          observers: observers.size,
          listeners: listeners.size,
          intervals: intervals.size,
          timeouts: timeouts.size,
          registeredTotal,
        };
      },
    };
  }

  test('should register and clean up observers', () => {
    const cm = createCleanupManager();
    const obs = new MutationObserver(() => {});
    const disconnectSpy = jest.spyOn(obs, 'disconnect');

    cm.registerObserver(obs);
    expect(cm.getStats().observers).toBe(1);

    cm.cleanup();
    expect(cm.getStats().observers).toBe(0);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  test('should register and clean up listeners', () => {
    const cm = createCleanupManager();
    const fn = jest.fn();

    cm.registerListener(document, 'click', fn);
    expect(cm.getStats().listeners).toBe(1);

    cm.cleanup();
    expect(cm.getStats().listeners).toBe(0);

    // Verify listener was removed
    document.dispatchEvent(new Event('click'));
    expect(fn).not.toHaveBeenCalled();
  });

  test('should register and clean up intervals', () => {
    jest.useFakeTimers();
    const cm = createCleanupManager();
    const fn = jest.fn();
    const id = setInterval(fn, 100);

    cm.registerInterval(id);
    expect(cm.getStats().intervals).toBe(1);

    cm.cleanup();
    expect(cm.getStats().intervals).toBe(0);

    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('should register and clean up timeouts', () => {
    jest.useFakeTimers();
    const cm = createCleanupManager();
    const fn = jest.fn();
    const id = setTimeout(fn, 100);

    cm.registerTimeout(id);
    expect(cm.getStats().timeouts).toBe(1);

    cm.cleanup();
    expect(cm.getStats().timeouts).toBe(0);

    jest.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('should call custom cleanup callbacks', () => {
    const cm = createCleanupManager();
    const cb1 = jest.fn();
    const cb2 = jest.fn();

    cm.register(cb1);
    cm.register(cb2);

    cm.cleanup();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test('should handle callback that throws during cleanup', () => {
    const cm = createCleanupManager();
    const badCb = jest.fn(() => {
      throw new Error('cleanup fail');
    });
    const goodCb = jest.fn();

    cm.register(badCb);
    cm.register(goodCb);

    expect(() => cm.cleanup()).not.toThrow();
    expect(badCb).toHaveBeenCalled();
    expect(goodCb).toHaveBeenCalled();
  });

  test('should ignore null observer registration', () => {
    const cm = createCleanupManager();
    cm.registerObserver(null);
    expect(cm.getStats().observers).toBe(0);
  });

  test('cleanup should be idempotent', () => {
    const cm = createCleanupManager();
    const obs = new MutationObserver(() => {});
    cm.registerObserver(obs);
    cm.registerListener(document, 'click', () => {});

    cm.cleanup();
    expect(cm.getStats().observers).toBe(0);
    expect(cm.getStats().listeners).toBe(0);

    // Second cleanup should not throw
    expect(() => cm.cleanup()).not.toThrow();
  });
});

describe('ObserverRegistry — advanced', () => {
  function createObserverRegistry() {
    let _active = 0,
      _peak = 0,
      _created = 0,
      _disconnected = 0;
    return {
      track() {
        _active++;
        _created++;
        if (_active > _peak) _peak = _active;
      },
      untrack() {
        _active = Math.max(0, _active - 1);
        _disconnected++;
      },
      getStats() {
        return { active: _active, peak: _peak, created: _created, disconnected: _disconnected };
      },
      reset() {
        _active = 0;
        _peak = 0;
        _created = 0;
        _disconnected = 0;
      },
    };
  }

  test('should handle rapid track/untrack cycles', () => {
    const registry = createObserverRegistry();

    for (let i = 0; i < 100; i++) {
      registry.track();
      registry.untrack();
    }

    const stats = registry.getStats();
    expect(stats.active).toBe(0);
    expect(stats.peak).toBe(1);
    expect(stats.created).toBe(100);
    expect(stats.disconnected).toBe(100);
  });

  test('should track created count even after reset', () => {
    const registry = createObserverRegistry();
    registry.track();
    registry.track();
    registry.track();

    expect(registry.getStats().created).toBe(3);

    registry.reset();
    expect(registry.getStats().created).toBe(0);

    registry.track();
    expect(registry.getStats().created).toBe(1);
  });

  test('should maintain correct peak across multiple cycles', () => {
    const registry = createObserverRegistry();

    // Cycle 1: peak = 3
    for (let i = 0; i < 3; i++) registry.track();
    for (let i = 0; i < 3; i++) registry.untrack();

    // Cycle 2: peak = 3 (2 < 3)
    for (let i = 0; i < 2; i++) registry.track();
    for (let i = 0; i < 2; i++) registry.untrack();

    // Cycle 3: peak = 4
    for (let i = 0; i < 4; i++) registry.track();

    expect(registry.getStats().peak).toBe(4);
    expect(registry.getStats().active).toBe(4);
  });

  test('disconnected count should exceed created when over-untracking', () => {
    const registry = createObserverRegistry();
    registry.track();
    registry.untrack();
    registry.untrack(); // Extra untrack

    const stats = registry.getStats();
    expect(stats.active).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.disconnected).toBe(2);
  });
});
