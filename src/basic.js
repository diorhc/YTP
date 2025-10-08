const YouTubeUtils = (() => {
  'use strict';

  /**
   * Error logging with module context
   * @param {string} module - Module name
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (module, message, error) => {
    console.error(`[YouTube+][${module}] ${message}:`, error);
  };

  /**
   * Safe function wrapper with error handling
   * @param {Function} fn - Function to wrap
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped function
   */
  const safeExecute = (fn, context = 'Unknown') => {
    return function (...args) {
      try {
        return fn.apply(this, args);
      } catch (error) {
        logError(context, 'Execution failed', error);
        return null;
      }
    };
  };

  /**
   * Safe async function wrapper with error handling
   * @param {Function} fn - Async function to wrap
   * @param {string} context - Context for error logging
   * @returns {Function} Wrapped async function
   */
  const safeExecuteAsync = (fn, context = 'Unknown') => {
    return async function (...args) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        logError(context, 'Async execution failed', error);
        return null;
      }
    };
  };

  /**
   * Sanitize HTML string to prevent XSS
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML
   */
  const sanitizeHTML = (html) => {
    if (typeof html !== 'string') return '';

    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
    };

    return html.replace(/[<>&"'\/]/g, (char) => map[char]);
  };

  /**
   * Validate URL to prevent injection attacks
   * @param {string} url - URL to validate
   * @returns {boolean} Whether URL is safe
   */
  const isValidURL = (url) => {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  /**
   * Safe localStorage wrapper
   */
  const storage = {
    /**
     * Get item from localStorage with JSON parsing
     * @param {string} key - Storage key
     * @param {*} defaultValue - Default value if key doesn't exist
     * @returns {*} Parsed value or default
     */
    get: (key, defaultValue = null) => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return defaultValue;
        }
        const value = localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch (e) {
        logError('Storage', `Failed to get item: ${key}`, e);
        return defaultValue;
      }
    },

    /**
     * Set item to localStorage with JSON serialization
     * @param {string} key - Storage key
     * @param {*} value - Value to store
     * @returns {boolean} Success status
     */
    set: (key, value) => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return false;
        }
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        logError('Storage', `Failed to set item: ${key}`, e);
        return false;
      }
    },

    /**
     * Remove item from localStorage
     * @param {string} key - Storage key
     */
    remove: (key) => {
      try {
        if (typeof key !== 'string' || !key) {
          logError('Storage', 'Invalid storage key', new Error('Key must be a non-empty string'));
          return;
        }
        localStorage.removeItem(key);
      } catch (e) {
        logError('Storage', `Failed to remove item: ${key}`, e);
      }
    },
  };

  /**
   * Optimized debounce function with cleanup
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in ms
   * @param {Object} options - Options {leading: boolean}
   * @returns {Function} Debounced function with cancel method
   */
  const debounce = (func, wait, options = {}) => {
    let timeout;
    let lastArgs;
    let lastThis;

    const debounced = function (...args) {
      lastArgs = args;
      lastThis = this;
      clearTimeout(timeout);

      if (options.leading && !timeout) {
        func.apply(this, args);
      }

      timeout = setTimeout(() => {
        if (!options.leading) {
          func.apply(lastThis, lastArgs);
        }
        timeout = null;
        lastArgs = null;
        lastThis = null;
      }, wait);
    };

    debounced.cancel = () => {
      clearTimeout(timeout);
      timeout = null;
      lastArgs = null;
      lastThis = null;
    };

    return debounced;
  };

  /**
   * Throttle function for rate limiting
   * @param {Function} func - Function to throttle
   * @param {number} limit - Time limit in ms
   * @returns {Function} Throttled function
   */
  const throttle = (func, limit) => {
    let inThrottle;
    let lastResult;

    return function (...args) {
      if (!inThrottle) {
        lastResult = func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
      return lastResult;
    };
  };

  /**
   * Safe DOM element creation with props and children
   * @param {string} tag - HTML tag name
   * @param {Object} props - Element properties
   * @param {Array} children - Child elements or text
   * @returns {HTMLElement} Created element
   */
  const createElement = (tag, props = {}, children = []) => {
    // Validate tag name to prevent XSS
    const validTags = /^[a-z][a-z0-9-]*$/i;
    if (!validTags.test(tag)) {
      logError('createElement', 'Invalid tag name', new Error(`Tag "${tag}" is not allowed`));
      return document.createElement('div');
    }

    const element = document.createElement(tag);

    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.substring(2).toLowerCase(), value);
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(element.dataset, value);
      } else if (key === 'innerHTML' || key === 'outerHTML') {
        // Prevent direct HTML injection
        logError(
          'createElement',
          'Direct HTML injection prevented',
          new Error('Use children array instead')
        );
      } else {
        try {
          element.setAttribute(key, value);
        } catch (e) {
          logError('createElement', `Failed to set attribute ${key}`, e);
        }
      }
    });

    children.forEach((child) => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof Node) {
        element.appendChild(child);
      }
    });

    return element;
  };

  /**
   * DOM Selector Cache with automatic cleanup
   */
  const selectorCache = new Map();
  const CACHE_MAX_SIZE = 50;
  const CACHE_MAX_AGE = 5000; // 5 seconds

  /**
   * Cached querySelector with LRU-like eviction
   * @param {string} selector - CSS selector
   * @param {boolean} nocache - Skip cache
   * @returns {HTMLElement|null} Found element
   */
  const querySelector = (selector, nocache = false) => {
    if (nocache) return document.querySelector(selector);

    const now = Date.now();
    const cached = selectorCache.get(selector);

    // Check if cached element is still valid
    if (cached?.element?.isConnected && now - cached.timestamp < CACHE_MAX_AGE) {
      return cached.element;
    }

    // Remove stale entry
    if (cached) {
      selectorCache.delete(selector);
    }

    const element = document.querySelector(selector);

    if (element) {
      // LRU eviction: remove oldest entries if cache is full
      if (selectorCache.size >= CACHE_MAX_SIZE) {
        const firstKey = selectorCache.keys().next().value;
        selectorCache.delete(firstKey);
      }

      selectorCache.set(selector, { element, timestamp: now });
    }

    return element;
  };

  /**
   * Wait for element with timeout and AbortController
   * @param {string} selector - CSS selector
   * @param {number} timeout - Timeout in ms
   * @param {HTMLElement} parent - Parent element to search in
   * @returns {Promise<HTMLElement>} Promise resolving to element
   */
  const waitForElement = (selector, timeout = 5000, parent = document.body) => {
    return new Promise((resolve, reject) => {
      // Validate inputs
      if (!selector || typeof selector !== 'string') {
        reject(new Error('Selector must be a non-empty string'));
        return;
      }

      if (!parent || !(parent instanceof Element)) {
        reject(new Error('Parent must be a valid DOM element'));
        return;
      }

      // Check if element already exists
      try {
        const element = parent.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
      } catch (e) {
        reject(new Error(`Invalid selector: ${selector}`));
        return;
      }

      const controller = new AbortController();
      let observer;

      const timeoutId = setTimeout(() => {
        controller.abort();
        if (observer) {
          try {
            observer.disconnect();
          } catch (e) {
            logError('waitForElement', 'Observer disconnect failed', e);
          }
        }
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);

      observer = new MutationObserver(() => {
        try {
          const element = parent.querySelector(selector);
          if (element) {
            clearTimeout(timeoutId);
            observer.disconnect();
            resolve(element);
          }
        } catch (e) {
          logError('waitForElement', 'Observer callback error', e);
        }
      });

      try {
        observer.observe(parent, {
          childList: true,
          subtree: true,
          signal: controller.signal,
        });
      } catch (e) {
        // Fallback for browsers without signal support
        try {
          observer.observe(parent, { childList: true, subtree: true });
        } catch (observeError) {
          clearTimeout(timeoutId);
          reject(new Error('Failed to observe DOM: ' + observeError.message));
        }
      }
    });
  };

  /**
   * Resource Cleanup Manager
   * Manages observers, listeners, and intervals
   */
  const cleanupManager = {
    observers: new Set(),
    listeners: new Map(),
    intervals: new Set(),
    timeouts: new Set(),
    animationFrames: new Set(),

    /**
     * Register MutationObserver for cleanup
     * @param {MutationObserver} observer - Observer to register
     * @returns {MutationObserver} Registered observer
     */
    registerObserver: (observer) => {
      cleanupManager.observers.add(observer);
      return observer;
    },

    /**
     * Unregister and disconnect specific observer
     * @param {MutationObserver} observer - Observer to unregister
     */
    unregisterObserver: (observer) => {
      if (observer) {
        try {
          observer.disconnect();
        } catch (e) {
          logError('Cleanup', 'Observer disconnect failed', e);
        }
        cleanupManager.observers.delete(observer);
      }
    },

    /**
     * Register event listener for cleanup
     * @param {HTMLElement} element - Target element
     * @param {string} event - Event name
     * @param {Function} handler - Event handler
     * @param {Object} options - Event listener options
     * @returns {Symbol} Listener key for later removal
     */
    registerListener: (element, event, handler, options) => {
      const key = Symbol('listener');
      cleanupManager.listeners.set(key, { element, event, handler, options });
      element.addEventListener(event, handler, options);
      return key;
    },

    /**
     * Unregister specific listener
     * @param {Symbol} key - Listener key
     */
    unregisterListener: (key) => {
      const listener = cleanupManager.listeners.get(key);
      if (listener) {
        const { element, event, handler, options } = listener;
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          logError('Cleanup', 'Listener removal failed', e);
        }
        cleanupManager.listeners.delete(key);
      }
    },

    /**
     * Register interval for cleanup
     * @param {number} id - Interval ID
     * @returns {number} Interval ID
     */
    registerInterval: (id) => {
      cleanupManager.intervals.add(id);
      return id;
    },

    /**
     * Unregister specific interval
     * @param {number} id - Interval ID
     */
    unregisterInterval: (id) => {
      clearInterval(id);
      cleanupManager.intervals.delete(id);
    },

    /**
     * Register timeout for cleanup
     * @param {number} id - Timeout ID
     * @returns {number} Timeout ID
     */
    registerTimeout: (id) => {
      cleanupManager.timeouts.add(id);
      return id;
    },

    /**
     * Unregister specific timeout
     * @param {number} id - Timeout ID
     */
    unregisterTimeout: (id) => {
      clearTimeout(id);
      cleanupManager.timeouts.delete(id);
    },

    /**
     * Register animation frame for cleanup
     * @param {number} id - Animation frame ID
     * @returns {number} Animation frame ID
     */
    registerAnimationFrame: (id) => {
      cleanupManager.animationFrames.add(id);
      return id;
    },

    /**
     * Unregister specific animation frame
     * @param {number} id - Animation frame ID
     */
    unregisterAnimationFrame: (id) => {
      cancelAnimationFrame(id);
      cleanupManager.animationFrames.delete(id);
    },

    /**
     * Cleanup all registered resources
     */
    cleanup: () => {
      // Disconnect all observers
      cleanupManager.observers.forEach((obs) => {
        try {
          obs.disconnect();
        } catch (e) {
          logError('Cleanup', 'Observer disconnect failed', e);
        }
      });
      cleanupManager.observers.clear();

      // Remove all listeners
      cleanupManager.listeners.forEach(({ element, event, handler, options }) => {
        try {
          element.removeEventListener(event, handler, options);
        } catch (e) {
          logError('Cleanup', 'Listener removal failed', e);
        }
      });
      cleanupManager.listeners.clear();

      // Clear all intervals
      cleanupManager.intervals.forEach((id) => clearInterval(id));
      cleanupManager.intervals.clear();

      // Clear all timeouts
      cleanupManager.timeouts.forEach((id) => clearTimeout(id));
      cleanupManager.timeouts.clear();

      // Cancel all animation frames
      cleanupManager.animationFrames.forEach((id) => cancelAnimationFrame(id));
      cleanupManager.animationFrames.clear();
    },
  };

  /**
   * Settings Manager
   * Centralized settings storage and retrieval
   */
  const SettingsManager = {
    storageKey: 'youtube_plus_all_settings_v2',

    defaults: {
      speedControl: { enabled: true, currentSpeed: 1 },
      screenshot: { enabled: true },
      download: { enabled: true },
      updateChecker: { enabled: true },
      adBlocker: { enabled: true },
      pip: { enabled: true },
      timecodes: { enabled: true },
      // Add other modules...
    },

    /**
     * Load all settings
     * @returns {Object} Settings object
     */
    load() {
      const saved = storage.get(this.storageKey);
      return saved ? { ...this.defaults, ...saved } : { ...this.defaults };
    },

    /**
     * Save all settings
     * @param {Object} settings - Settings to save
     */
    save(settings) {
      storage.set(this.storageKey, settings);
      // Dispatch event for modules to react
      window.dispatchEvent(
        new CustomEvent('youtube-plus-settings-changed', {
          detail: settings,
        })
      );
    },

    /**
     * Get setting by path
     * @param {string} path - Dot-separated path (e.g., 'speedControl.enabled')
     * @returns {*} Setting value
     */
    get(path) {
      const settings = this.load();
      return path.split('.').reduce((obj, key) => obj?.[key], settings);
    },

    /**
     * Set setting by path
     * @param {string} path - Dot-separated path
     * @param {*} value - Value to set
     */
    set(path, value) {
      const settings = this.load();
      const keys = path.split('.');
      const last = keys.pop();
      const target = keys.reduce((obj, key) => {
        obj[key] = obj[key] || {};
        return obj[key];
      }, settings);
      target[last] = value;
      this.save(settings);
    },
  };

  /**
   * Style Manager
   * Centralized CSS injection and management
   */
  const StyleManager = {
    styles: new Map(),
    element: null,

    /**
     * Add CSS rules
     * @param {string} id - Unique identifier
     * @param {string} css - CSS rules
     */
    add(id, css) {
      if (typeof id !== 'string' || !id) {
        logError('StyleManager', 'Invalid style ID', new Error('ID must be a non-empty string'));
        return;
      }
      if (typeof css !== 'string') {
        logError('StyleManager', 'Invalid CSS', new Error('CSS must be a string'));
        return;
      }
      this.styles.set(id, css);
      this.update();
    },

    /**
     * Remove CSS rules
     * @param {string} id - Identifier
     */
    remove(id) {
      this.styles.delete(id);
      this.update();
    },

    /**
     * Update style element
     */
    update() {
      try {
        if (!this.element) {
          this.element = document.createElement('style');
          this.element.id = 'youtube-plus-styles';
          this.element.type = 'text/css';
          (document.head || document.documentElement).appendChild(this.element);
        }
        this.element.textContent = Array.from(this.styles.values()).join('\n');
      } catch (error) {
        logError('StyleManager', 'Failed to update styles', error);
      }
    },

    /**
     * Clear all styles
     */
    clear() {
      this.styles.clear();
      if (this.element) {
        try {
          this.element.remove();
        } catch (e) {
          logError('StyleManager', 'Failed to remove style element', e);
        }
        this.element = null;
      }
    },
  };

  /**
   * Centralized Notification System
   * Manages all notifications with queue and deduplication
   */
  const NotificationManager = {
    queue: [],
    activeNotifications: new Set(),
    maxVisible: 3,
    defaultDuration: 3000,

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {Object} options - Notification options
     * @returns {HTMLElement} Notification element
     */
    show(message, options = {}) {
      // Validate message
      if (!message || typeof message !== 'string') {
        logError(
          'NotificationManager',
          'Invalid message',
          new Error('Message must be a non-empty string')
        );
        return null;
      }

      const {
        type = 'info',
        duration = this.defaultDuration,
        position = null,
        dismissible = true,
        action = null, // { text: string, callback: function }
      } = options;

      // Remove duplicate messages
      this.activeNotifications.forEach((notif) => {
        if (notif.dataset.message === message) {
          this.remove(notif);
        }
      });

      const colors = {
        info: 'rgba(34, 197, 94, 0.9)',
        error: 'rgba(220, 38, 38, 0.9)',
        warning: 'rgba(251, 191, 36, 0.9)',
        update: 'linear-gradient(135deg, rgba(255, 69, 0, 0.95), rgba(255, 140, 0, 0.95))',
        success: 'rgba(34, 197, 94, 0.9)',
      };

      const positions = {
        'top-right': { top: '20px', right: '20px' },
        'top-left': { top: '20px', left: '20px' },
        'bottom-right': { bottom: '20px', right: '20px' },
        'bottom-left': { bottom: '20px', left: '20px' },
      };

      try {
        // Use shared enhancer notification class for consistent appearance
        const notification = createElement('div', {
          className: 'youtube-enhancer-notification',
          dataset: { message }, // Store message for deduplication
          // Keep minimal inline styles; main visuals come from the shared CSS class
          style: Object.assign(
            {
              zIndex: '10001',
              width: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            },
            position && positions[position] ? positions[position] : {}
          ),
        });

        // Add message (with accessibility attributes)
        notification.setAttribute('role', 'status');
        notification.setAttribute('aria-live', 'polite');
        notification.setAttribute('aria-atomic', 'true');

        const messageSpan = createElement(
          'span',
          {
            style: { flex: '1' },
          },
          [message]
        );
        notification.appendChild(messageSpan);

        // Add action button if provided
        if (action && action.text && typeof action.callback === 'function') {
          const actionBtn = createElement(
            'button',
            {
              style: {
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                color: 'white',
                padding: '4px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: '600',
                transition: 'background 0.2s',
              },
              onClick: () => {
                action.callback();
                this.remove(notification);
              },
            },
            [action.text]
          );
          notification.appendChild(actionBtn);
        }

        document.body.appendChild(notification);
        this.activeNotifications.add(notification);

        // Auto-dismiss
        if (duration > 0) {
          const timeoutId = setTimeout(() => this.remove(notification), duration);
          cleanupManager.registerTimeout(timeoutId);
        }

        // Limit visible notifications
        if (this.activeNotifications.size > this.maxVisible) {
          const oldest = Array.from(this.activeNotifications)[0];
          this.remove(oldest);
        }

        return notification;
      } catch (error) {
        logError('NotificationManager', 'Failed to show notification', error);
        return null;
      }
    },

    /**
     * Remove notification
     * @param {HTMLElement} notification - Notification element
     */
    remove(notification) {
      if (!notification || !notification.isConnected) return;

      try {
        notification.style.transform = 'translateY(100%)';
        notification.style.opacity = '0';

        const timeoutId = setTimeout(() => {
          try {
            notification.remove();
            this.activeNotifications.delete(notification);
          } catch (e) {
            logError('NotificationManager', 'Failed to remove notification', e);
          }
        }, 300);
        cleanupManager.registerTimeout(timeoutId);
      } catch (error) {
        logError('NotificationManager', 'Failed to animate notification removal', error);
        // Force remove
        notification.remove();
        this.activeNotifications.delete(notification);
      }
    },

    /**
     * Clear all notifications
     */
    clearAll() {
      this.activeNotifications.forEach((notif) => {
        try {
          notif.remove();
        } catch (e) {
          logError('NotificationManager', 'Failed to clear notification', e);
        }
      });
      this.activeNotifications.clear();
    },
  };

  // Add notification animation styles
  StyleManager.add(
    'notification-animations',
    `
    @keyframes slideInFromBottom {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `
  );

  // Global cleanup on page unload
  window.addEventListener('beforeunload', () => {
    cleanupManager.cleanup();
    selectorCache.clear();
    StyleManager.clear();
    NotificationManager.clearAll();
  });

  // Periodic cache cleanup to prevent memory leaks
  const cacheCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of selectorCache.entries()) {
      if (!value.element?.isConnected || now - value.timestamp > CACHE_MAX_AGE) {
        selectorCache.delete(key);
      }
    }
  }, 30000); // Clean every 30 seconds

  cleanupManager.registerInterval(cacheCleanupInterval);

  // Global error handler for uncaught promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logError('Global', 'Unhandled promise rejection', event.reason);
    event.preventDefault(); // Prevent console spam
  });

  // Global error handler for uncaught errors
  window.addEventListener('error', (event) => {
    // Only log errors from our script
    if (event.filename && event.filename.includes('youtube')) {
      logError(
        'Global',
        'Uncaught error',
        new Error(`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`)
      );
    }
  });

  /**
   * Performance monitoring wrapper
   * @param {string} label - Operation label
   * @param {Function} fn - Function to monitor
   * @returns {Function} Wrapped function
   */
  const measurePerformance = (label, fn) => {
    return function (...args) {
      const start = performance.now();
      try {
        const result = fn.apply(this, args);
        const duration = performance.now() - start;
        if (duration > 100) {
          console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
        }
        return result;
      } catch (error) {
        logError('Performance', `${label} failed`, error);
        throw error;
      }
    };
  };

  /**
   * Async performance monitoring wrapper
   * @param {string} label - Operation label
   * @param {Function} fn - Async function to monitor
   * @returns {Function} Wrapped async function
   */
  const measurePerformanceAsync = (label, fn) => {
    return async function (...args) {
      const start = performance.now();
      try {
        const result = await fn.apply(this, args);
        const duration = performance.now() - start;
        if (duration > 100) {
          console.warn(`[YouTube+][Performance] ${label} took ${duration.toFixed(2)}ms`);
        }
        return result;
      } catch (error) {
        logError('Performance', `${label} failed`, error);
        throw error;
      }
    };
  };

  /**
   * Mobile device detection
   * @returns {boolean} True if mobile device
   */
  const isMobile = () => {
    return (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      window.innerWidth <= 768
    );
  };

  /**
   * Get viewport dimensions
   * @returns {Object} Width and height
   */
  const getViewport = () => ({
    width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
  });

  /**
   * Safe async retry wrapper
   * @param {Function} fn - Async function to retry
   * @param {number} retries - Number of retries
   * @param {number} delay - Delay between retries
   * @returns {Promise} Result or error
   */
  const retryAsync = async (fn, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
      }
    }
  };

  // Export public API
  return {
    logError,
    safeExecute,
    safeExecuteAsync,
    sanitizeHTML,
    isValidURL,
    storage,
    debounce,
    throttle,
    createElement,
    querySelector,
    waitForElement,
    cleanupManager,
    SettingsManager,
    StyleManager,
    NotificationManager,
    clearCache: () => selectorCache.clear(),
    isMobile,
    getViewport,
    retryAsync,
    measurePerformance,
    measurePerformanceAsync,
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  window.YouTubeUtils = YouTubeUtils;

  // Add initialization health check
  console.log('[YouTube+ v2.0] Core utilities loaded successfully');
  console.log('[YouTube+] Features: Performance monitoring, Memory management, Error recovery');

  // Expose debug info
  window.YouTubePlusDebug = {
    version: '2.0',
    cacheSize: () =>
      YouTubeUtils.cleanupManager.observers.size +
      YouTubeUtils.cleanupManager.listeners.size +
      YouTubeUtils.cleanupManager.intervals.size,
    clearAll: () => {
      YouTubeUtils.cleanupManager.cleanup();
      YouTubeUtils.clearCache();
      YouTubeUtils.StyleManager.clear();
      YouTubeUtils.NotificationManager.clearAll();
      console.log('[YouTube+] All resources cleared');
    },
    stats: () => ({
      observers: YouTubeUtils.cleanupManager.observers.size,
      listeners: YouTubeUtils.cleanupManager.listeners.size,
      intervals: YouTubeUtils.cleanupManager.intervals.size,
      timeouts: YouTubeUtils.cleanupManager.timeouts.size,
      animationFrames: YouTubeUtils.cleanupManager.animationFrames.size,
      styles: YouTubeUtils.StyleManager.styles.size,
      notifications: YouTubeUtils.NotificationManager.activeNotifications.size,
    }),
  };

  // Show subtle startup notification (only once per session)
  if (!sessionStorage.getItem('youtube_plus_started')) {
    sessionStorage.setItem('youtube_plus_started', 'true');
    setTimeout(() => {
      if (YouTubeUtils.NotificationManager) {
        YouTubeUtils.NotificationManager.show('YouTube+ v2.0 loaded', {
          type: 'success',
          duration: 2000,
          position: 'bottom-right',
        });
      }
    }, 1000);
  }
} //-----------------------------------------------------------------------------
// YouTube enhancements module
(function () {
  'use strict';

  const YouTubeEnhancer = {
    // Speed control variables
    speedControl: {
      currentSpeed: 1,
      activeAnimationId: null,
      storageKey: 'youtube_playback_speed',
    },

    // Settings
    settings: {
      enableSpeedControl: true,
      enableScreenshot: true,
      enableDownload: true,
      // Состояние сайтов внутри сабменю кнопки Download (ytdl всегда включён)
      downloadSites: {
        y2mate: true,
        xbbuddy: true,
      },
      // Настройки кастомизации download сайтов
      downloadSiteCustomization: {
        y2mate: {
          name: 'Y2Mate',
          url: 'https://www.y2mate.com/youtube/{videoId}',
        },
        xbbuddy: {
          name: '9xbuddy',
          url: 'https://9xbuddy.org/process?url={videoUrl}',
        },
      },
      storageKey: 'youtube_plus_settings',
    },

    // Cache DOM queries
    _cache: new Map(),

    // Initialize everything
    init() {
      if (!/youtube\.com/.test(location.host)) return;

      try {
        this.loadSettings();
        this.speedControl.currentSpeed = parseFloat(
          localStorage.getItem(this.speedControl.storageKey) || 1
        );

        this.insertStyles();
        this.addSettingsButtonToHeader();
        this.setupNavigationObserver();
        this.setupCurrentPage();

        console.log('[YouTube+] YouTubeEnhancer v2.0 initialized successfully');
      } catch (error) {
        YouTubeUtils.logError('YouTubeEnhancer', 'Initialization failed', error);
      }
    },

    // Cached element getter
    getElement(selector, useCache = true) {
      if (useCache && this._cache.has(selector)) {
        const element = this._cache.get(selector);
        if (element?.isConnected) return element;
        this._cache.delete(selector);
      }

      const element = document.querySelector(selector);
      if (element && useCache) this._cache.set(selector, element);
      return element;
    },

    loadSettings() {
      try {
        const saved = localStorage.getItem(this.settings.storageKey);
        if (saved) Object.assign(this.settings, JSON.parse(saved));
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    },

    saveSettings() {
      localStorage.setItem(this.settings.storageKey, JSON.stringify(this.settings));
      this.updatePageBasedOnSettings();
      this.refreshDownloadButton();
    },

    updatePageBasedOnSettings() {
      const settingsMap = {
        'ytp-screenshot-button': 'enableScreenshot',
        'ytp-download-button': 'enableDownload',
        'speed-control-btn': 'enableSpeedControl',
      };

      Object.entries(settingsMap).forEach(([className, setting]) => {
        const button = this.getElement(`.${className}`, false);
        if (button) button.style.display = this.settings[setting] ? '' : 'none';
      });
    },

    refreshDownloadButton() {
      const selector = '.ytp-download-button';

      // Очистить кеш, чтобы избежать возврата удалённых элементов
      if (this._cache.has(selector)) {
        this._cache.delete(selector);
      }

      const existingButton = document.querySelector(selector);
      if (existingButton?.parentElement) {
        existingButton.remove();
      }

      if (!this.settings.enableDownload) {
        return;
      }

      const controls = this.getElement('.ytp-right-controls', false);
      if (!controls) {
        return;
      }

      this.addDownloadButton(controls);
    },

    setupCurrentPage() {
      this.waitForElement('#player-container-outer .html5-video-player, .ytp-right-controls', 5000)
        .then(() => {
          this.addCustomButtons();
          this.setupVideoObserver();
          this.applyCurrentSpeed();
          this.updatePageBasedOnSettings();
          this.refreshDownloadButton();
        })
        .catch(() => {});
    },

    insertStyles() {
      // Glassmorphism styles for modal and controls
      const styles = `:root{--yt-accent:#ff0000;--yt-accent-hover:#cc0000;--yt-radius-sm:6px;--yt-radius-md:10px;--yt-radius-lg:16px;--yt-transition:all .2s ease;--yt-space-xs:4px;--yt-space-sm:8px;--yt-space-md:16px;--yt-space-lg:24px;--yt-glass-blur:blur(18px) saturate(180%);--yt-glass-blur-light:blur(12px) saturate(160%);--yt-glass-blur-heavy:blur(24px) saturate(200%);}
        html[dark],html:not([dark]):not([light]){--yt-bg-primary:rgba(15,15,15,.85);--yt-bg-secondary:rgba(28,28,28,.85);--yt-bg-tertiary:rgba(34,34,34,.85);--yt-text-primary:#fff;--yt-text-secondary:#aaa;--yt-border-color:rgba(255,255,255,.2);--yt-hover-bg:rgba(255,255,255,.1);--yt-shadow:0 4px 12px rgba(0,0,0,.25);--yt-glass-bg:rgba(255,255,255,.1);--yt-glass-border:rgba(255,255,255,.2);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.2);--yt-modal-bg:rgba(0,0,0,.75);--yt-notification-bg:rgba(28,28,28,.9);--yt-panel-bg:rgba(34,34,34,.3);--yt-header-bg:rgba(20,20,20,.6);--yt-input-bg:rgba(255,255,255,.1);--yt-button-bg:rgba(255,255,255,.2);--yt-text-stroke:white;}
        html[light]{--yt-bg-primary:rgba(255,255,255,.85);--yt-bg-secondary:rgba(248,248,248,.85);--yt-bg-tertiary:rgba(240,240,240,.85);--yt-text-primary:#030303;--yt-text-secondary:#606060;--yt-border-color:rgba(0,0,0,.2);--yt-hover-bg:rgba(0,0,0,.05);--yt-shadow:0 4px 12px rgba(0,0,0,.15);--yt-glass-bg:rgba(255,255,255,.7);--yt-glass-border:rgba(0,0,0,.1);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.1);--yt-modal-bg:rgba(0,0,0,.5);--yt-notification-bg:rgba(255,255,255,.95);--yt-panel-bg:rgba(255,255,255,.7);--yt-header-bg:rgba(248,248,248,.8);--yt-input-bg:rgba(0,0,0,.05);--yt-button-bg:rgba(0,0,0,.1);--yt-text-stroke:#030303;}
        .ytp-screenshot-button,.ytp-cobalt-button,.ytp-pip-button{position:relative;bottom:12px;width:44px;transition:opacity .15s,transform .15s;}
        .ytp-screenshot-button:hover,.ytp-cobalt-button:hover,.ytp-pip-button:hover{transform:scale(1.1);}
        .speed-control-btn{width:4em!important;float:left;text-align:center!important;border-radius:var(--yt-radius-sm);font-size:13px;color:var(--yt-text-primary);cursor:pointer;user-select:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;transition:color .2s;}
        .speed-control-btn:hover{color:var(--yt-accent);font-weight:bold;}
        .speed-options{position:absolute!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;border-radius:var(--yt-radius-md)!important;display:none;bottom: 100%!important;width:48px!important;z-index:9999!important;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .speed-option-item{cursor:pointer!important;height:25px!important;line-height:25px!important;font-size:12px!important;text-align:center!important;transition:background-color .15s,color .15s;}
        .speed-option-active,.speed-option-item:hover{color:var(--yt-accent)!important;font-weight:bold!important;background:var(--yt-hover-bg)!important;}
        #speed-indicator{position:absolute!important;margin:auto!important;top:0!important;right:0!important;bottom:0!important;left:0!important;border-radius:24px!important;font-size:30px!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;z-index:99999!important;width:80px!important;height:80px!important;line-height:80px!important;text-align:center!important;display:none;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);}
        .youtube-enhancer-notification{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:12px 24px;border-radius:var(--yt-radius-md);z-index:9999;transition:opacity .5s,transform .3s;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);font-weight:500;}
        .ytp-plus-settings-button{background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;padding:var(--yt-space-sm);margin-right:var(--yt-space-sm);border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background-color .2s,transform .2s;}
        .ytp-plus-settings-button svg{width:24px;height:24px;}
        .ytp-plus-settings-button:hover{background:var(--yt-hover-bg);transform:rotate(30deg);color:var(--yt-text-secondary);}
        .ytp-plus-settings-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);animation:ytEnhanceFadeIn .25s ease-out;}
        .ytp-plus-settings-panel{background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-lg);width:720px;max-width:90%;max-height:90vh;overflow:hidden;box-shadow:var(--yt-glass-shadow);animation:ytEnhanceScaleIn .3s cubic-bezier(.4,0,.2,1);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);will-change:transform,opacity;display:flex;flex-direction:row;}
        .ytp-plus-settings-sidebar{width:200px;background:var(--yt-header-bg);border-right:1px solid var(--yt-glass-border);display:flex;flex-direction:column;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .ytp-plus-settings-sidebar-header{padding:var(--yt-space-md) var(--yt-space-lg);border-bottom:1px solid var(--yt-glass-border);display:flex;justify-content:space-between;align-items:center;}
        .ytp-plus-settings-title{font-size:18px;font-weight:500;margin:0;color:var(--yt-text-primary);}
        .ytp-plus-settings-sidebar-close{padding:var(--yt-space-md) var(--yt-space-lg);display:flex;justify-content:flex-end;background:transparent;}
        .ytp-plus-settings-close{background:none;border:none;cursor:pointer;padding:var(--yt-space-sm);margin:-8px;color:var(--yt-text-primary);transition:color .2s,transform .2s;}
        .ytp-plus-settings-close:hover{color:var(--yt-accent);transform:scale(1.25) rotate(90deg);}
        .ytp-plus-settings-nav{flex:1;padding:var(--yt-space-md) 0;}
        .ytp-plus-settings-nav-item{display:flex;align-items:center;padding:12px var(--yt-space-lg);cursor:pointer;transition:all .2s cubic-bezier(.4,0,.2,1);font-size:14px;border-left:3px solid transparent;color:var(--yt-text-primary);}
        .ytp-plus-settings-nav-item:hover{background:var(--yt-hover-bg);}
        .ytp-plus-settings-nav-item.active{background:rgba(255,0,0,.1);border-left-color:var(--yt-accent);color:var(--yt-accent);font-weight:500;}
        .ytp-plus-settings-nav-item svg{width:18px;height:18px;margin-right:12px;opacity:.8;transition:opacity .2s,transform .2s;}
        .ytp-plus-settings-nav-item.active svg{opacity:1;transform:scale(1.1);}
        .ytp-plus-settings-nav-item:hover svg{transform:scale(1.05);}
        .ytp-plus-settings-main{flex:1;display:flex;flex-direction:column;overflow-y:auto;}
        .ytp-plus-settings-header{padding:var(--yt-space-md) var(--yt-space-lg);border-bottom:1px solid var(--yt-glass-border);background:var(--yt-header-bg);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .ytp-plus-settings-content{flex:1;padding:var(--yt-space-md) var(--yt-space-lg);overflow-y:auto;}
        .ytp-plus-settings-section{margin-bottom:var(--yt-space-lg);}
        .ytp-plus-settings-section-title{font-size:16px;font-weight:500;margin-bottom:var(--yt-space-md);color:var(--yt-text-primary);}
        .ytp-plus-settings-section.hidden{display:none;}
        .ytp-plus-settings-item{display:flex;align-items:center;margin-bottom:var(--yt-space-md);padding:14px 18px;background:transparent;transition:all .25s cubic-bezier(.4,0,.2,1);border-radius:var(--yt-radius-md);}
        .ytp-plus-settings-item:hover{background:var(--yt-hover-bg);transform:translateX(6px);box-shadow:0 2px 8px rgba(0,0,0,.1);}
        .ytp-plus-settings-item-label{flex:1;font-size:14px;color:var(--yt-text-primary);}
        .ytp-plus-settings-item-description{font-size:12px;color:var(--yt-text-secondary);margin-top:4px;}
        .ytp-plus-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:15px;height:15px;margin-left:auto;border:1px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:all 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:#fff;}
        html:not([dark]) .ytp-plus-settings-checkbox{border-color:rgba(0,0,0,.25);color:#222;}
        .ytp-plus-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
        .ytp-plus-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
        .ytp-plus-settings-checkbox::before{content:"";width:4px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:4px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:9px;left:6px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox:checked{transform:rotate(0deg) scale(1.2);}
        .ytp-plus-settings-checkbox:checked::before{width:8px;opacity:1;background:#fff;transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
        .ytp-plus-settings-checkbox:checked::after{width:15px;opacity:1;background:#fff;transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
        .ytp-plus-footer{padding:var(--yt-space-md) var(--yt-space-lg);border-top:1px solid var(--yt-glass-border);display:flex;justify-content:flex-end;background:transparent;}
        .ytp-plus-button{padding:var(--yt-space-sm) var(--yt-space-md);border-radius:18px;border:none;font-size:14px;font-weight:500;cursor:pointer;transition:all .25s cubic-bezier(.4,0,.2,1);}
        .ytp-plus-button-primary{background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);}
        .ytp-plus-button-primary:hover{background:var(--yt-accent);color:#fff;box-shadow:0 6px 16px rgba(255,0,0,.35);transform:translateY(-2px);}
        .app-icon{fill:var(--yt-text-primary);stroke:var(--yt-text-primary);transition:all .3s;}
        @keyframes ytEnhanceFadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes ytEnhanceScaleIn{from{opacity:0;transform:scale(.92) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
        @media(max-width:768px){.ytp-plus-settings-panel{width:95%;max-height:80vh;flex-direction:column;}
        .ytp-plus-settings-sidebar{width:100%;max-height:120px;flex-direction:row;overflow-x:auto;}
        .ytp-plus-settings-nav{display:flex;flex-direction:row;padding:0;}
        .ytp-plus-settings-nav-item{white-space:nowrap;border-left:none;border-bottom:3px solid transparent;}
        .ytp-plus-settings-nav-item.active{border-left:none;border-bottom-color:var(--yt-accent);}
        .ytp-plus-settings-item{padding:10px 12px;}
        }
        .ytp-plus-settings-section h1{margin:-95px 90px 8px;font-family:'Montserrat',sans-serif;font-size:52px;font-weight:600;color:transparent;-webkit-text-stroke-width:1px;-webkit-text-stroke-color:var(--yt-text-stroke);cursor:pointer;transition:color .2s;}
        .ytp-plus-settings-section h1:hover{color:var(--yt-accent);-webkit-text-stroke-width:1px;-webkit-text-stroke-color:transparent;}
        .download-options{position:fixed;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-md);width:150px;z-index:99999;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);display:none;}
        .download-options.visible{display:block;}
        .download-options-list{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;}
        .download-option-item{cursor:pointer;padding:12px;text-align:center;transition:background .2s,color .2s;width:100%;}
        .download-option-item:hover{background:var(--yt-hover-bg);color:var(--yt-accent);}
        .glass-panel{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow);}
        .glass-card{background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-md);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);box-shadow:var(--yt-shadow);}
        .glass-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .glass-button{background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-sm) var(--yt-space-md);color:var(--yt-text-primary);cursor:pointer;transition:all .2s ease;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .glass-button:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .download-site-option{display:flex;flex-direction:column;align-items:stretch;gap:8px;}
        .download-site-header{display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;gap:8px;}
        .download-site-controls{width:100%;margin-top:6px;}
        .download-site-cta{display:flex;flex-direction:row;gap:8px;margin-top:6px;}
        .download-site-cta .glass-button{width:100%;}
        .download-site-option .ytp-plus-settings-checkbox{margin:0;}
        .download-site-name{font-weight:600;color:var(--yt-text-primary);}
        .download-site-desc{font-size:12px;color:var(--yt-text-secondary);margin-top:2px;}
        `;

      // ✅ Use StyleManager instead of createElement('style')
      if (!document.getElementById('yt-enhancer-styles')) {
        YouTubeUtils.StyleManager.add('yt-enhancer-main', styles);
      }
    },

    addSettingsButtonToHeader() {
      this.waitForElement('ytd-masthead #end', 5000)
        .then((headerEnd) => {
          if (!this.getElement('.ytp-plus-settings-button')) {
            const settingsButton = document.createElement('div');
            settingsButton.className = 'ytp-plus-settings-button';
            settingsButton.setAttribute('title', 'YouTube + Settings');
            settingsButton.innerHTML = `
                <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M39.23,26a16.52,16.52,0,0,0,.14-2,16.52,16.52,0,0,0-.14-2l4.33-3.39a1,1,0,0,0,.25-1.31l-4.1-7.11a1,1,0,0,0-1.25-.44l-5.11,2.06a15.68,15.68,0,0,0-3.46-2l-.77-5.43a1,1,0,0,0-1-.86H19.9a1,1,0,0,0-1,.86l-.77,5.43a15.36,15.36,0,0,0-3.46,2L9.54,9.75a1,1,0,0,0-1.25.44L4.19,17.3a1,1,0,0,0,.25,1.31L8.76,22a16.66,16.66,0,0,0-.14,2,16.52,16.52,0,0,0,.14,2L4.44,29.39a1,1,0,0,0-.25,1.31l4.1,7.11a1,1,0,0,0,1.25.44l5.11-2.06a15.68,15.68,0,0,0,3.46,2l.77,5.43a1,1,0,0,0,1,.86h8.2a1,1,0,0,0,1-.86l.77-5.43a15.36,15.36,0,0,0,3.46-2l5.11,2.06a1,1,0,0,0,1.25-.44l4.1-7.11a1,1,0,0,0-.25-1.31ZM24,31.18A7.18,7.18,0,1,1,31.17,24,7.17,7.17,0,0,1,24,31.18Z"/>
                </svg>
              `;

            settingsButton.addEventListener('click', this.openSettingsModal.bind(this));

            const avatarButton = headerEnd.querySelector('ytd-topbar-menu-button-renderer');
            if (avatarButton) {
              headerEnd.insertBefore(settingsButton, avatarButton);
            } else {
              headerEnd.appendChild(settingsButton);
            }
          }
        })
        .catch(() => {});
    },

    createSettingsModal() {
      const modal = document.createElement('div');
      modal.className = 'ytp-plus-settings-modal';

      modal.innerHTML = `
          <div class="ytp-plus-settings-panel">
            <div class="ytp-plus-settings-sidebar">
              <div class="ytp-plus-settings-sidebar-header">
                <h2 class="ytp-plus-settings-title">Settings</h2>                
              </div>
              <div class="ytp-plus-settings-nav">
                <div class="ytp-plus-settings-nav-item active" data-section="basic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="9" cy="9" r="2"/>
                    <path d="m21 15-3.086-3.086a2 2 0 0 0-1.414-.586H13l-2-2v3h6l3 3"/>
                  </svg>
                  Basic
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="advanced">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="m12 1 0 6m0 6 0 6"/>
                    <path d="m17.5 6.5-4.5 4.5m0 0-4.5 4.5m9-9L12 12l5.5 5.5"/>
                  </svg>
                  Advanced
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="experimental">
                  <svg width="64px" height="64px" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M18.019 4V15.0386L6.27437 39.3014C5.48686 40.9283 6.16731 42.8855 7.79421 43.673C8.23876 43.8882 8.72624 44 9.22013 44H38.7874C40.5949 44 42.0602 42.5347 42.0602 40.7273C42.0602 40.2348 41.949 39.7488 41.7351 39.3052L30.0282 15.0386V4H18.019Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"></path> <path d="M10.9604 29.9998C13.1241 31.3401 15.2893 32.0103 17.4559 32.0103C19.6226 32.0103 21.7908 31.3401 23.9605 29.9998C26.1088 28.6735 28.2664 28.0103 30.433 28.0103C32.5997 28.0103 34.7755 28.6735 36.9604 29.9998" stroke="currentColor" stroke-width="4" stroke-linecap="round"></path>
                  </svg>
                  Experimental
                </div>
                <div class="ytp-plus-settings-nav-item" data-section="about">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m9 12 2 2 4-4"/>
                  </svg>
                  About
                </div>
              </div>
            </div>
            <div class="ytp-plus-settings-main">
              <div class="ytp-plus-settings-sidebar-close">
                <button class="ytp-plus-settings-close" aria-label="Close">
                  <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
                  </svg>
                </button>
              </div>              
              <div class="ytp-plus-settings-content">                
                <div class="ytp-plus-settings-section" data-section="basic">
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Speed Control</label>
                      <div class="ytp-plus-settings-item-description">Add speed control buttons to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableSpeedControl" ${this.settings.enableSpeedControl ? 'checked' : ''}>
                  </div>
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Screenshot Button</label>
                      <div class="ytp-plus-settings-item-description">Add screenshot capture button to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableScreenshot" ${this.settings.enableScreenshot ? 'checked' : ''}>
                  </div>
                  <div class="ytp-plus-settings-item">
                    <div>
                      <label class="ytp-plus-settings-item-label">Download Button</label>
                      <div class="ytp-plus-settings-item-description">Add download button with multiple site options to video player</div>
                    </div>
                    <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableDownload" ${this.settings.enableDownload ? 'checked' : ''}>
                  </div>
                  <div class="download-submenu" style="display:${this.settings.enableDownload ? 'block' : 'none'};margin-left:12px;margin-bottom:12px;">
                    <div class="glass-card" style="display:flex;flex-direction:column;gap:8px;">
                      <div class="download-site-option">
                        <div class="download-site-header">
                          <div>
                            <div class="download-site-name">${this.settings.downloadSiteCustomization?.y2mate?.name || 'Y2Mate'}</div>
                            <div class="download-site-desc">Use custom downloader</div>
                          </div>
                          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="downloadSite_y2mate" ${this.settings.downloadSites?.y2mate ? 'checked' : ''}>
                        </div>
                        <div class="download-site-controls" style="display:${this.settings.downloadSites?.y2mate ? 'block' : 'none'};">
                          <input type="text" placeholder="Site name" value="${this.settings.downloadSiteCustomization?.y2mate?.name || 'Y2Mate'}" 
                              data-site="y2mate" data-field="name" class="download-site-input" 
                              style="width:100%;margin-top:6px;padding:6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">
                          <input type="text" placeholder="URL template (use {videoId} or {videoUrl})" value="${this.settings.downloadSiteCustomization?.y2mate?.url || 'https://www.y2mate.com/youtube/{videoId}'}" 
                            data-site="y2mate" data-field="url" class="download-site-input" 
                            style="width:100%;margin-top:4px;padding:6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:11px;">
                          <div class="download-site-cta">
                            <button class="glass-button" id="download-y2mate-save" style="padding:6px 10px;font-size:12px;">Save</button>
                            <button class="glass-button" id="download-y2mate-reset" style="padding:6px 10px;font-size:12px;background:rgba(255,0,0,0.12);">Reset</button>
                          </div>
                        </div>
                      </div>

                      <div class="download-site-option">
                        <div class="download-site-header">
                          <div>
                            <div class="download-site-name">${this.settings.downloadSiteCustomization?.xbbuddy?.name || '9xbuddy'}</div>
                            <div class="download-site-desc">Use custom downloader</div>
                          </div>
                          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="downloadSite_xbbuddy" ${this.settings.downloadSites?.xbbuddy ? 'checked' : ''}>
                        </div>
                        <div class="download-site-controls" style="display:${this.settings.downloadSites?.xbbuddy ? 'block' : 'none'};">
                          <input type="text" placeholder="Site name" value="${this.settings.downloadSiteCustomization?.xbbuddy?.name || '9xbuddy'}" 
                            data-site="xbbuddy" data-field="name" class="download-site-input" 
                            style="width:100%;margin-top:6px;padding:6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:12px;">
                          <input type="text" placeholder="URL template (use {videoId} or {videoUrl})" value="${this.settings.downloadSiteCustomization?.xbbuddy?.url || 'https://9xbuddy.org/process?url={videoUrl}'}" 
                            data-site="xbbuddy" data-field="url" class="download-site-input" 
                            style="width:100%;margin-top:4px;padding:6px;background:rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;font-size:11px;">
                          <div class="download-site-cta">
                            <button class="glass-button" id="download-xbbuddy-save" style="padding:6px 10px;font-size:12px;">Save</button>
                            <button class="glass-button" id="download-xbbuddy-reset" style="padding:6px 10px;font-size:12px;background:rgba(255,0,0,0.12);">Reset</button>
                          </div>
                        </div>
                      </div>

                      <div class="download-site-option" style="padding:4px 0;">
                        <div>
                          <div class="download-site-name">by YTDL</div>
                          <div class="download-site-desc">Always enabled - GitHub repository</div>
                        </div>
                        <button class="glass-button" id="open-ytdl-github" style="margin:0;padding:10px 14px;font-size:13px;">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                            <polyline points="15,3 21,3 21,9"/>
                            <line x1="10" y1="14" x2="21" y2="3"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div class="ytp-plus-settings-section hidden" data-section="advanced">
                </div>

                <div class="ytp-plus-settings-section hidden" data-section="experimental">
                </div>
                
                <div class="ytp-plus-settings-section hidden" data-section="about">
                  <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
                    <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.1 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.1,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
                  </svg>
                    <h1>YouTube +</h1><br><br>
                </div>
              </div>
              <div class="ytp-plus-footer">
                <button class="ytp-plus-button ytp-plus-button-primary" id="ytp-plus-save-settings">Save Changes</button>
              </div>
            </div>
          </div>
        `;

      // Event delegation for better performance
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
        if (
          e.target.classList.contains('ytp-plus-settings-close') ||
          e.target.closest('.ytp-plus-settings-close')
        )
          modal.remove();

        // Обработка кнопки GitHub для YTDL
        if (e.target.id === 'open-ytdl-github' || e.target.closest('#open-ytdl-github')) {
          window.open('https://github.com/diorhc/YouTube-Downloader', '_blank');
          return;
        }

        if (e.target.classList.contains('ytp-plus-settings-nav-item')) {
          // Handle sidebar navigation
          const section = e.target.dataset.section;
          modal
            .querySelectorAll('.ytp-plus-settings-nav-item')
            .forEach((item) => item.classList.remove('active'));
          modal
            .querySelectorAll('.ytp-plus-settings-section')
            .forEach((section) => section.classList.add('hidden'));

          e.target.classList.add('active');
          modal
            .querySelector(`.ytp-plus-settings-section[data-section="${section}"]`)
            .classList.remove('hidden');
        }

        if (e.target.classList.contains('ytp-plus-settings-checkbox')) {
          const setting = e.target.dataset.setting;
          if (!setting) return;

          // Сохранение простых настроек (enableSpeedControl, enableScreenshot, enableDownload)
          if (!setting.startsWith('downloadSite_')) {
            this.settings[setting] = e.target.checked;

            // Показывать/скрывать сабменю при переключении Download
            if (setting === 'enableDownload') {
              const submenu = modal.querySelector('.download-submenu');
              if (submenu) submenu.style.display = e.target.checked ? 'block' : 'none';
            }
          } else {
            // Обработка чекбоксов в сабменю: data-setting = downloadSite_<key>
            const key = setting.replace('downloadSite_', '');
            if (!this.settings.downloadSites) this.settings.downloadSites = {};
            this.settings.downloadSites[key] = e.target.checked;
            // Toggle visibility of controls for this site (if present in DOM)
            try {
              const checkbox = e.target;
              const container = checkbox.closest('.download-site-option');
              if (container) {
                const controls = container.querySelector('.download-site-controls');
                if (controls) controls.style.display = e.target.checked ? 'block' : 'none';
              }
            } catch (err) {
              console.warn('[YouTube+] toggle download-site-controls failed:', err);
            }
            // Rebuild dropdown if present
            try {
              if (
                typeof window !== 'undefined' &&
                window.youtubePlus &&
                typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
              ) {
                window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
                window.youtubePlus.rebuildDownloadDropdown();
              }
            } catch (err) {
              console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
            }
          }
        }

        // Обработка кастомизации download сайтов
        if (e.target.classList.contains('download-site-input')) {
          const site = e.target.dataset.site;
          const field = e.target.dataset.field;
          if (!site || !field) return;

          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {};
          }
          if (!this.settings.downloadSiteCustomization[site]) {
            this.settings.downloadSiteCustomization[site] = { name: '', url: '' };
          }

          this.settings.downloadSiteCustomization[site][field] = e.target.value;

          // Обновить имя в UI в реальном времени
          if (field === 'name') {
            const nameDisplay = e.target
              .closest('.download-site-option')
              ?.querySelector('.download-site-name');
            if (nameDisplay)
              nameDisplay.textContent =
                e.target.value || (site === 'y2mate' ? 'Y2Mate' : '9xbuddy');
          }
          // Rebuild dropdown if present so changes reflect immediately
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
        }

        if (e.target.id === 'ytp-plus-save-settings') {
          this.saveSettings();
          modal.remove();
          this.showNotification('Settings saved');
        }
        // Save specific Y2Mate customization
        if (e.target.id === 'download-y2mate-save') {
          // Ensure settings structure
          if (!this.settings.downloadSiteCustomization)
            this.settings.downloadSiteCustomization = {};
          if (!this.settings.downloadSiteCustomization.y2mate)
            this.settings.downloadSiteCustomization.y2mate = {};
          // Read current inputs inside this download-site-option
          const container = e.target.closest('.download-site-option');
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="url"]'
            );
            if (nameInput) this.settings.downloadSiteCustomization.y2mate.name = nameInput.value;
            if (urlInput) this.settings.downloadSiteCustomization.y2mate.url = urlInput.value;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('Y2Mate settings saved');
        }

        // Reset Y2Mate to defaults
        if (e.target.id === 'download-y2mate-reset') {
          if (!this.settings.downloadSiteCustomization)
            this.settings.downloadSiteCustomization = {};
          this.settings.downloadSiteCustomization.y2mate = {
            name: 'Y2Mate',
            url: 'https://www.y2mate.com/youtube/{videoId}',
          };
          // Update inputs in modal if present
          const container = modal.querySelector('.download-site-option');
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="y2mate"][data-field="url"]'
            );
            const nameDisplay = container.querySelector('.download-site-name');
            if (nameInput) nameInput.value = this.settings.downloadSiteCustomization.y2mate.name;
            if (urlInput) urlInput.value = this.settings.downloadSiteCustomization.y2mate.url;
            if (nameDisplay)
              nameDisplay.textContent = this.settings.downloadSiteCustomization.y2mate.name;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('Y2Mate reset to defaults');
        }

        // Save specific 9xBuddy customization
        if (e.target.id === 'download-xbbuddy-save') {
          if (!this.settings.downloadSiteCustomization)
            this.settings.downloadSiteCustomization = {};
          if (!this.settings.downloadSiteCustomization.xbbuddy)
            this.settings.downloadSiteCustomization.xbbuddy = {};
          const container = e.target.closest('.download-site-option');
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="url"]'
            );
            if (nameInput) this.settings.downloadSiteCustomization.xbbuddy.name = nameInput.value;
            if (urlInput) this.settings.downloadSiteCustomization.xbbuddy.url = urlInput.value;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('9xBuddy settings saved');
        }

        // Reset 9xBuddy to defaults
        if (e.target.id === 'download-xbbuddy-reset') {
          if (!this.settings.downloadSiteCustomization)
            this.settings.downloadSiteCustomization = {};
          this.settings.downloadSiteCustomization.xbbuddy = {
            name: '9xbuddy',
            url: 'https://9xbuddy.org/process?url={videoUrl}',
          };
          // Update inputs in modal if present
          const container = modal.querySelectorAll('.download-site-option')[1];
          if (container) {
            const nameInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="name"]'
            );
            const urlInput = container.querySelector(
              'input.download-site-input[data-site="xbbuddy"][data-field="url"]'
            );
            const nameDisplay = container.querySelector('.download-site-name');
            if (nameInput) nameInput.value = this.settings.downloadSiteCustomization.xbbuddy.name;
            if (urlInput) urlInput.value = this.settings.downloadSiteCustomization.xbbuddy.url;
            if (nameDisplay)
              nameDisplay.textContent = this.settings.downloadSiteCustomization.xbbuddy.name;
          }
          this.saveSettings();
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
          this.showNotification('9xBuddy reset to defaults');
        }
      });

      // Обработка изменений input полей для кастомизации
      modal.addEventListener('input', (e) => {
        if (e.target.classList.contains('download-site-input')) {
          const site = e.target.dataset.site;
          const field = e.target.dataset.field;
          if (!site || !field) return;

          if (!this.settings.downloadSiteCustomization) {
            this.settings.downloadSiteCustomization = {};
          }
          if (!this.settings.downloadSiteCustomization[site]) {
            this.settings.downloadSiteCustomization[site] = { name: '', url: '' };
          }

          this.settings.downloadSiteCustomization[site][field] = e.target.value;

          // Обновить имя в UI в реальном времени
          if (field === 'name') {
            const nameDisplay = e.target
              .closest('.download-site-option')
              ?.querySelector('.download-site-name');
            if (nameDisplay)
              nameDisplay.textContent =
                e.target.value || (site === 'y2mate' ? 'Y2Mate' : '9xbuddy');
          }
          // Rebuild dropdown if present so changes reflect immediately
          try {
            if (
              typeof window !== 'undefined' &&
              window.youtubePlus &&
              typeof window.youtubePlus.rebuildDownloadDropdown === 'function'
            ) {
              window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
              window.youtubePlus.rebuildDownloadDropdown();
            }
          } catch (err) {
            console.warn('[YouTube+] rebuildDownloadDropdown call failed:', err);
          }
        }
      });

      return modal;
    },

    openSettingsModal() {
      const existingModal = this.getElement('.ytp-plus-settings-modal', false);
      if (existingModal) existingModal.remove();
      document.body.appendChild(this.createSettingsModal());
    },

    waitForElement(selector, timeout = 5000) {
      // ✅ Use centralized utility
      return YouTubeUtils.waitForElement(selector, timeout);
    },

    addCustomButtons() {
      const controls = this.getElement('.ytp-right-controls');
      if (!controls) return;

      if (!this.getElement('.ytp-screenshot-button')) this.addScreenshotButton(controls);
      if (!this.getElement('.ytp-download-button')) this.addDownloadButton(controls);
      if (!this.getElement('.speed-control-btn')) this.addSpeedControlButton(controls);

      if (!document.getElementById('speed-indicator')) {
        const indicator = document.createElement('div');
        indicator.id = 'speed-indicator';
        const player = document.getElementById('movie_player');
        if (player) player.appendChild(indicator);
      }

      this.handleFullscreenChange();
    },

    addScreenshotButton(controls) {
      const button = document.createElement('button');
      button.className = 'ytp-button ytp-screenshot-button';
      button.setAttribute('title', 'Take screenshot');
      button.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19.83,8.77l-2.77,2.84H6.29A1.79,1.79,0,0,0,4.5,13.4V36.62a1.8,1.8,0,0,0,1.79,1.8H41.71a1.8,1.8,0,0,0,1.79-1.8V13.4a1.79,1.79,0,0,0-1.79-1.79H30.94L28.17,8.77Zm18.93,5.74a1.84,1.84,0,1,1,0,3.68A1.84,1.84,0,0,1,38.76,14.51ZM24,17.71a8.51,8.51,0,1,1-8.51,8.51A8.51,8.51,0,0,1,24,17.71Z"/>
          </svg>
        `;
      button.addEventListener('click', this.captureFrame.bind(this));
      controls.insertBefore(button, controls.firstChild);
    },

    addDownloadButton(controls) {
      if (!this.settings.enableDownload) return;
      const button = document.createElement('div');
      button.className = 'ytp-button ytp-download-button';
      button.setAttribute('title', 'Download options');
      button.setAttribute('tabindex', '0');
      button.setAttribute('role', 'button');
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      button.style.display = 'inline-block';
      button.style.padding = '0 10px 0 0';
      button.style.height = '36px';
      button.innerHTML = `
          <svg fill="currentColor" width="24" height="24" viewBox="0 0 256 256" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto;vertical-align:middle;">
        <path d="M83.17188,112.83984a4.00026,4.00026,0,0,1,5.65624-5.6582L124,142.34473V40a4,4,0,0,1,8,0V142.34473l35.17188-35.16309a4.00026,4.00026,0,0,1,5.65624,5.6582l-42,41.98926a4.00088,4.00088,0,0,1-5.65624,0ZM216,148a4.0002,4.0002,0,0,0-4,4v56a4.00427,4.00427,0,0,1-4,4H48a4.00427,4.00427,0,0,1-4-4V152a4,4,0,0,0-8,0v56a12.01343,12.01343,0,0,0,12,12H208a12.01343,12.01343,0,0,0,12-12V152A4.0002,4.0002,0,0,0,216,148Z"/>
          </svg>
        `;

      // Dropdown options
      const options = document.createElement('div');
      options.className = 'download-options';
      options.setAttribute('role', 'menu');

      // Position dropdown below button
      function positionDropdown() {
        const rect = button.getBoundingClientRect();
        options.style.left = `${rect.left + rect.width / 2 - 75}px`;
        options.style.bottom = `${window.innerHeight - rect.top + 12}px`;
      }

      // Helper to open download site
      function openDownloadSite(url, isYTDL = false) {
        if (isYTDL) {
          // For YTDL: copy video URL to clipboard and open localhost
          const videoId = new URLSearchParams(location.search).get('v');
          const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

          // Copy to clipboard
          navigator.clipboard
            .writeText(videoUrl)
            .then(() => {
              // Show notification
              YouTubeUtils.NotificationManager.show('URL скопирован в буфер обмена!', {
                duration: 2000,
                type: 'success',
              });
            })
            .catch(() => {
              // Fallback for older browsers
              const input = document.createElement('input');
              input.value = videoUrl;
              document.body.appendChild(input);
              input.select();
              document.execCommand('copy');
              document.body.removeChild(input);
              YouTubeUtils.NotificationManager.show('URL скопирован в буфер обмена!', {
                duration: 2000,
                type: 'success',
              });
            });

          // Open YTDL in new tab
          window.open(url, '_blank');
        } else {
          window.open(url, '_blank');
        }
        options.classList.remove('visible');
        button.setAttribute('aria-expanded', 'false');
      }

      // Helper to rebuild the dropdown if settings changed while dropdown exists
      // Exposed on button element via dataset so external handlers can trigger a rebuild
      function rebuildDropdown() {
        try {
          // Remove existing list if present
          const existingList = options.querySelector('.download-options-list');
          if (existingList) existingList.remove();

          // Rebuild downloadSites from current settings
          const customizationNow =
            typeof window !== 'undefined' &&
            window.youtubePlus &&
            window.youtubePlus.settings &&
            window.youtubePlus.settings.downloadSiteCustomization
              ? window.youtubePlus.settings.downloadSiteCustomization
              : customization;
          const videoIdNow = new URLSearchParams(location.search).get('v');
          const videoUrlNow = videoIdNow
            ? `https://www.youtube.com/watch?v=${videoIdNow}`
            : location.href;
          const buildUrlNow = (template) =>
            (template || '')
              .replace('{videoId}', videoIdNow || '')
              .replace('{videoUrl}', encodeURIComponent(videoUrlNow));

          const baseSitesNow = [
            {
              key: 'y2mate',
              name: customizationNow?.y2mate?.name || 'Y2Mate',
              url: buildUrlNow(
                customizationNow?.y2mate?.url || `https://www.y2mate.com/youtube/{videoId}`
              ),
              isYTDL: false,
            },
            {
              key: 'xbbuddy',
              name: customizationNow?.xbbuddy?.name || '9xbuddy',
              url: buildUrlNow(
                customizationNow?.xbbuddy?.url || `https://9xbuddy.org/process?url={videoUrl}`
              ),
              isYTDL: false,
            },
            { key: 'ytdl', name: 'by YTDL', url: `http://localhost:5005`, isYTDL: true },
          ];

          const enabledSitesNow =
            typeof window !== 'undefined' &&
            window.youtubePlus &&
            window.youtubePlus.settings &&
            window.youtubePlus.settings.downloadSites
              ? window.youtubePlus.settings.downloadSites
              : enabledSites;

          const downloadSitesNow = baseSitesNow.filter((s) => {
            if (s.key === 'ytdl') return true;
            return enabledSitesNow[s.key] !== false;
          });

          // If only one site remains replace click handler
          if (downloadSitesNow.length === 1) {
            const single = downloadSitesNow[0];
            // Remove any existing clickable handlers on button
            button.replaceWith(button.cloneNode(true));
            const newButton = controls.querySelector('.ytp-download-button');
            if (newButton)
              newButton.addEventListener('click', () =>
                openDownloadSite(single.url, single.isYTDL)
              );
            return;
          }

          // Build new list
          const newList = document.createElement('div');
          newList.className = 'download-options-list';
          downloadSitesNow.forEach((site) => {
            const opt = document.createElement('div');
            opt.className = 'download-option-item';
            opt.textContent = site.name;
            opt.setAttribute('role', 'menuitem');
            opt.setAttribute('tabindex', '0');
            opt.addEventListener('click', () => openDownloadSite(site.url, site.isYTDL));
            opt.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') openDownloadSite(site.url, site.isYTDL);
            });
            newList.appendChild(opt);
          });
          options.appendChild(newList);
        } catch (err) {
          console.warn('[YouTube+] rebuildDropdown failed:', err);
        }
      }

      // Get current video URL
      const videoId = new URLSearchParams(location.search).get('v');
      const videoUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href;

      // Получить кастомные настройки или использовать defaults
      const customization = this.settings.downloadSiteCustomization || {
        y2mate: { name: 'Y2Mate', url: 'https://www.y2mate.com/youtube/{videoId}' },
        xbbuddy: { name: '9xbuddy', url: 'https://9xbuddy.org/process?url={videoUrl}' },
      };

      // Функция для замены плейсхолдеров в URL
      const buildUrl = (template) => {
        return template
          .replace('{videoId}', videoId || '')
          .replace('{videoUrl}', encodeURIComponent(videoUrl));
      };

      // List of download sites (ytdl всегда включён, filter by user settings.downloadSites для остальных)
      const baseSites = [
        {
          key: 'y2mate',
          name: customization.y2mate?.name || 'Y2Mate',
          url: buildUrl(customization.y2mate?.url || `https://www.y2mate.com/youtube/{videoId}`),
          isYTDL: false,
        },
        {
          key: 'xbbuddy',
          name: customization.xbbuddy?.name || '9xbuddy',
          url: buildUrl(customization.xbbuddy?.url || `https://9xbuddy.org/process?url={videoUrl}`),
          isYTDL: false,
        },
        { key: 'ytdl', name: 'by YTDL', url: `http://localhost:5005`, isYTDL: true },
      ];

      const enabledSites =
        this.settings && this.settings.downloadSites
          ? this.settings.downloadSites
          : { y2mate: true, xbbuddy: true };

      // YTDL всегда включён, фильтруем остальные по настройкам
      const downloadSites = baseSites.filter((s) => {
        if (s.key === 'ytdl') return true; // ytdl всегда включён
        return enabledSites[s.key] !== false;
      });

      // Если активен только один сайт — прямой переход без dropdown
      if (downloadSites.length === 1) {
        const singleSite = downloadSites[0];
        button.style.cursor = 'pointer';
        button.addEventListener('click', () => openDownloadSite(singleSite.url, singleSite.isYTDL));
        controls.insertBefore(button, controls.firstChild);
        return; // Не создаём dropdown
      }

      // Centered list
      const list = document.createElement('div');
      list.className = 'download-options-list';

      downloadSites.forEach((site) => {
        const opt = document.createElement('div');
        opt.className = 'download-option-item';
        opt.textContent = site.name;
        opt.setAttribute('role', 'menuitem');
        opt.setAttribute('tabindex', '0');
        opt.addEventListener('click', () => openDownloadSite(site.url, site.isYTDL));
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            openDownloadSite(site.url, site.isYTDL);
          }
        });
        list.appendChild(opt);
      });

      options.appendChild(list);

      button.appendChild(options);

      // Expose rebuild function globally (safe guard) so settings handlers can call it
      try {
        if (typeof window !== 'undefined') {
          window.youtubePlus = window.youtubePlus || {};
          window.youtubePlus.rebuildDownloadDropdown = rebuildDropdown;
          // also store settings ref for rebuildDropdown to read
          window.youtubePlus.settings = window.youtubePlus.settings || this.settings;
        }
      } catch (e) {
        console.warn('[YouTube+] expose rebuildDownloadDropdown failed:', e);
      }

      let dropdownTimeout;
      function showDropdown() {
        clearTimeout(dropdownTimeout);
        positionDropdown();
        options.classList.add('visible');
        button.setAttribute('aria-expanded', 'true');
      }
      function hideDropdown() {
        dropdownTimeout = setTimeout(() => {
          options.classList.remove('visible');
          button.setAttribute('aria-expanded', 'false');
        }, 150);
      }
      button.addEventListener('mouseenter', showDropdown);
      button.addEventListener('mouseleave', hideDropdown);
      options.addEventListener('mouseenter', showDropdown);
      options.addEventListener('mouseleave', hideDropdown);
      button.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (options.classList.contains('visible')) {
            hideDropdown();
          } else {
            showDropdown();
          }
        }
      });

      controls.insertBefore(button, controls.firstChild);
    },

    addSpeedControlButton(controls) {
      const speedBtn = document.createElement('div');
      speedBtn.className = 'ytp-button speed-control-btn';
      speedBtn.innerHTML = `<span>${this.speedControl.currentSpeed}×</span>`;

      const speedOptions = document.createElement('div');
      speedOptions.className = 'speed-options';

      [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].forEach((speed) => {
        const option = document.createElement('div');
        option.className = `speed-option-item${parseFloat(speed) === this.speedControl.currentSpeed ? ' speed-option-active' : ''}`;
        option.textContent = `${speed}x`;
        option.dataset.speed = speed;
        option.addEventListener('click', () => this.changeSpeed(speed));
        speedOptions.appendChild(option);
      });

      speedBtn.appendChild(speedOptions);

      let isHovering = false;
      speedBtn.addEventListener('mouseenter', () => {
        isHovering = true;
        speedOptions.style.display = 'block';
      });

      speedBtn.addEventListener('mouseleave', () => {
        isHovering = false;
        setTimeout(() => {
          if (!isHovering) speedOptions.style.display = 'none';
        }, 150);
      });

      controls.insertBefore(speedBtn, controls.firstChild);
    },

    captureFrame() {
      const video = this.getElement('video', false);
      if (!video) return;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const videoTitle = document.title.replace(/\s-\sYouTube$/, '').trim();
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${videoTitle}.png`;
      link.click();
    },

    showNotification(message, duration = 2000) {
      YouTubeUtils.NotificationManager.show(message, { duration, type: 'info' });
    },

    handleFullscreenChange() {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      document.querySelectorAll('.ytp-screenshot-button, .ytp-cobalt-button').forEach((button) => {
        button.style.bottom = isFullscreen ? '15px' : '12px';
      });
    },

    changeSpeed(speed) {
      speed = parseFloat(speed);
      this.speedControl.currentSpeed = speed;
      localStorage.setItem(this.speedControl.storageKey, speed);

      const speedBtn = this.getElement('.speed-control-btn span', false);
      if (speedBtn) speedBtn.textContent = `${speed}×`;

      document.querySelectorAll('.speed-option-item').forEach((option) => {
        option.classList.toggle('speed-option-active', parseFloat(option.dataset.speed) === speed);
      });

      this.applyCurrentSpeed();
      this.showSpeedIndicator(speed);
    },

    applyCurrentSpeed() {
      document.querySelectorAll('video').forEach((video) => {
        if (video && video.playbackRate !== this.speedControl.currentSpeed) {
          video.playbackRate = this.speedControl.currentSpeed;
        }
      });
    },

    setupVideoObserver() {
      if (this._speedInterval) clearInterval(this._speedInterval);
      this._speedInterval = setInterval(() => this.applyCurrentSpeed(), 1000);

      // ✅ Register interval in cleanupManager
      YouTubeUtils.cleanupManager.registerInterval(this._speedInterval);
    },

    setupNavigationObserver() {
      let lastUrl = location.href;

      document.addEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));

      document.addEventListener('yt-navigate-finish', () => {
        if (location.href.includes('watch?v=')) this.setupCurrentPage();
        this.addSettingsButtonToHeader();
      });

      // ✅ Register observer in cleanupManager
      const observer = new MutationObserver(() => {
        if (lastUrl !== location.href) {
          lastUrl = location.href;
          if (location.href.includes('watch?v=')) {
            setTimeout(() => this.setupCurrentPage(), 500);
          }
          this.addSettingsButtonToHeader();
        }
      });

      YouTubeUtils.cleanupManager.registerObserver(observer);
      observer.observe(document.body, { childList: true, subtree: true });
    },

    showSpeedIndicator(speed) {
      const indicator = document.getElementById('speed-indicator');
      if (!indicator) return;

      if (this.speedControl.activeAnimationId) {
        cancelAnimationFrame(this.speedControl.activeAnimationId);
        YouTubeUtils.cleanupManager.unregisterAnimationFrame(this.speedControl.activeAnimationId);
        this.speedControl.activeAnimationId = null;
      }

      indicator.textContent = `${speed}×`;
      indicator.style.display = 'block';
      indicator.style.opacity = '0.8';

      let startTime = performance.now();
      const fadeOut = (timestamp) => {
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / 1500, 1);

        indicator.style.opacity = 0.8 * (1 - progress);

        if (progress < 1) {
          this.speedControl.activeAnimationId = YouTubeUtils.cleanupManager.registerAnimationFrame(
            requestAnimationFrame(fadeOut)
          );
        } else {
          indicator.style.display = 'none';
          this.speedControl.activeAnimationId = null;
        }
      };

      this.speedControl.activeAnimationId = YouTubeUtils.cleanupManager.registerAnimationFrame(
        requestAnimationFrame(fadeOut)
      );
    },
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', YouTubeEnhancer.init.bind(YouTubeEnhancer))
    : YouTubeEnhancer.init();
})();
