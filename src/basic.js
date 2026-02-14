const YouTubeUtils = (() => {
  'use strict';

  // Import helper modules
  const Security = window.YouTubePlusSecurity || {};
  const Storage = window.YouTubePlusStorage || {};
  const Performance = window.YouTubePlusPerformance || {};

  /**
   * Translation function with fallback support
   * Uses centralized i18n from YouTubePlusI18n
   * @param {string} key - Translation key
   * @param {Object} params - Parameters for interpolation
   * @returns {string} Translated string
   */
  const t = (key, params = {}) => {
    if (window.YouTubePlusI18n?.t) return window.YouTubePlusI18n.t(key, params);
    if (window.YouTubeUtils?.t && window.YouTubeUtils.t !== t) {
      return window.YouTubeUtils.t(key, params);
    }
    // Fallback for initialization phase
    if (!key) return '';
    let result = String(key);
    for (const [k, v] of Object.entries(params || {})) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  };

  /**
   * Error logging with module context (local reference)
   * @param {string} module - Module name
   * @param {string} message - Error message
   * @param {Error} error - Error object
   */
  const logError = (module, message, error) => {
    console.error(`[YouTube+][${module}] ${message}:`, error);
  };

  // Use helper modules or fallback to local implementations
  const safeExecute =
    Security.safeExecute ||
    ((fn, context = 'Unknown') => {
      /** @this {any} */
      return function (...args) {
        try {
          return fn.call(this, ...args);
        } catch (error) {
          logError(context, 'Execution failed', error);
          return null;
        }
      };
    });

  const safeExecuteAsync =
    Security.safeExecuteAsync ||
    ((fn, context = 'Unknown') => {
      /** @this {any} */
      return async function (...args) {
        try {
          return await fn.call(this, ...args);
        } catch (error) {
          logError(context, 'Async execution failed', error);
          return null;
        }
      };
    });

  const sanitizeHTML =
    Security.sanitizeHTML ||
    (html => {
      if (typeof html !== 'string') return '';
      return html.replace(/[<>&"'\/`=]/g, '');
    });

  const isValidURL =
    Security.isValidURL ||
    (url => {
      if (typeof url !== 'string') return false;
      try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
      } catch {
        return false;
      }
    });

  // Use storage helper or fallback
  const storage = Storage || {
    get: (key, defaultValue = null) => {
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
      } catch {
        return defaultValue;
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove: key => {
      try {
        localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };

  // Use performance helpers or fallback
  const debounce =
    Performance?.debounce ||
    ((func, wait, options = {}) => {
      let timeout = null;
      /** @this {any} */
      const debounced = function (...args) {
        if (timeout !== null) clearTimeout(timeout);
        if (options.leading && timeout === null) {
          func.call(this, ...args);
        }
        timeout = setTimeout(() => {
          if (!options.leading) func.call(this, ...args);
          timeout = null;
        }, wait);
      };
      debounced.cancel = () => {
        if (timeout !== null) clearTimeout(timeout);
        timeout = null;
      };
      return debounced;
    });

  const throttle =
    Performance?.throttle ||
    ((func, limit) => {
      let inThrottle = false;
      /** @this {any} */
      return function (...args) {
        if (!inThrottle) {
          func.call(this, ...args);
          inThrottle = true;
          setTimeout(() => {
            inThrottle = false;
          }, limit);
        }
      };
    });

  /**
   * Safe DOM element creation with props and children
   * @param {string} tag - HTML tag name
   * @param {Object} props - Element properties
   * @param {Array<string | Node>} children - Child elements or text
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

    children.forEach(child => {
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
  const CACHE_MAX_SIZE = 100; // Increased for better performance
  const CACHE_MAX_AGE = 10000; // 10 seconds - longer retention

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
   * Validate waitForElement parameters
   * @param {string} selector - CSS selector
   * @param {HTMLElement} parent - Parent element
   * @returns {Error|null} Validation error or null
   */
  const validateWaitParams = (selector, parent) => {
    if (!selector || typeof selector !== 'string') {
      return new Error('Selector must be a non-empty string');
    }
    if (!parent || !(parent instanceof Element)) {
      return new Error('Parent must be a valid DOM element');
    }
    return null;
  };

  /**
   * Try to find element immediately
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @returns {{element: HTMLElement|null, error: Error|null}} Result object
   */
  const tryQuerySelector = (parent, selector) => {
    try {
      const element = parent.querySelector(selector);
      return { element, error: null };
    } catch {
      return { element: null, error: new Error(`Invalid selector: ${selector}`) };
    }
  };

  /**
   * Cleanup observer and timeout resources
   * @param {MutationObserver|null} observer - Observer to disconnect
   * @param {number} timeoutId - Timeout ID to clear
   * @param {AbortController} controller - Abort controller
   */
  const cleanupWaitResources = (observer, timeoutId, controller) => {
    controller.abort();
    if (observer) {
      try {
        observer.disconnect();
      } catch (e) {
        logError('waitForElement', 'Observer disconnect failed', e);
      }
    }
    clearTimeout(timeoutId);
  };

  /**
   * Create and setup mutation observer for element watching
   * @param {HTMLElement} parent - Parent element
   * @param {string} selector - CSS selector
   * @param {Function} resolve - Promise resolve function
   * @param {number} timeoutId - Timeout ID for cleanup
   * @returns {MutationObserver} Created observer
   */
  const createWaitObserver = (parent, selector, resolve, timeoutId) => {
    return new MutationObserver(() => {
      try {
        const element = parent.querySelector(selector);
        if (element) {
          clearTimeout(timeoutId);
          resolve(/** @type {HTMLElement} */ (/** @type {unknown} */ (element)));
        }
      } catch (e) {
        logError('waitForElement', 'Observer callback error', e);
      }
    });
  };

  /**
   * Start observing parent element for DOM changes
   * @param {MutationObserver} observer - Observer instance
   * @param {HTMLElement} parent - Parent element to observe
   * @returns {Error|null} Error if observation failed
   */
  const startWaitObservation = (observer, parent) => {
    try {
      if (!(parent instanceof Element) && parent !== document) {
        throw new Error('Parent does not support observation');
      }
      observer.observe(parent, { childList: true, subtree: true });
      return null;
    } catch {
      try {
        observer.observe(parent, { childList: true, subtree: true });
        return null;
      } catch {
        return new Error('Failed to observe DOM');
      }
    }
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
      const validationError = validateWaitParams(selector, parent);
      if (validationError) {
        reject(validationError);
        return;
      }

      const { element, error } = tryQuerySelector(parent, selector);
      if (error) {
        reject(error);
        return;
      }
      if (element) {
        resolve(/** @type {HTMLElement} */ (/** @type {unknown} */ (element)));
        return;
      }

      const controller = new AbortController();
      /** @type {MutationObserver | null} */
      let observer = null;

      const timeoutId = setTimeout(() => {
        cleanupWaitResources(observer, timeoutId, controller);
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);

      observer = createWaitObserver(parent, selector, resolve, timeoutId);

      const observeError = startWaitObservation(observer, parent);
      if (observeError) {
        clearTimeout(timeoutId);
        reject(observeError);
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
    cleanupFunctions: new Set(),

    /**
     * Register a generic cleanup function
     * @param {Function} fn - Cleanup function to call during cleanup
     * @returns {Function} The registered function
     */
    register: fn => {
      if (typeof fn === 'function') {
        cleanupManager.cleanupFunctions.add(fn);
      }
      return fn;
    },

    /**
     * Unregister a specific cleanup function
     * @param {Function} fn - Function to unregister
     */
    unregister: fn => {
      cleanupManager.cleanupFunctions.delete(fn);
    },

    /**
     * Register MutationObserver for cleanup
     * @param {MutationObserver} observer - Observer to register
     * @returns {MutationObserver} Registered observer
     */
    registerObserver: observer => {
      cleanupManager.observers.add(observer);
      return observer;
    },

    /**
     * Unregister and disconnect specific observer
     * @param {MutationObserver} observer - Observer to unregister
     */
    unregisterObserver: observer => {
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
     * @param {EventTarget|Document|Window} element - Target element
     * @param {string} event - Event name
     * @param {EventListener|EventListenerObject} handler - Event handler
     * @param {Object} options - Event listener options
     * @returns {Symbol} Listener key for later removal
     */
    registerListener: (element, event, handler, options) => {
      const key = Symbol('listener');
      cleanupManager.listeners.set(key, { element, event, handler, options });
      try {
        element.addEventListener(event, /** @type {EventListener} */ (handler), options);
      } catch {
        // best-effort: if addEventListener fails, still register the listener record
      }
      return key;
    },

    /**
     * Unregister specific listener
     * @param {Symbol} key - Listener key
     */
    unregisterListener: key => {
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
     * @param {TimerId} id - Interval ID
     * @returns {TimerId} Interval ID
     */
    registerInterval: id => {
      cleanupManager.intervals.add(id);
      return id;
    },

    /**
     * Unregister specific interval
     * @param {number} id - Interval ID
     */
    unregisterInterval: id => {
      clearInterval(id);
      cleanupManager.intervals.delete(id);
    },

    /**
     * Register timeout for cleanup
     * @param {TimerId} id - Timeout ID
     * @returns {TimerId} Timeout ID
     */
    registerTimeout: id => {
      cleanupManager.timeouts.add(id);
      return id;
    },

    /**
     * Unregister specific timeout
     * @param {number} id - Timeout ID
     */
    unregisterTimeout: id => {
      clearTimeout(id);
      cleanupManager.timeouts.delete(id);
    },

    /**
     * Register animation frame for cleanup
     * @param {number} id - Animation frame ID
     * @returns {number} Animation frame ID
     */
    registerAnimationFrame: id => {
      cleanupManager.animationFrames.add(id);
      return id;
    },

    /**
     * Unregister specific animation frame
     * @param {number} id - Animation frame ID
     */
    unregisterAnimationFrame: id => {
      cancelAnimationFrame(id);
      cleanupManager.animationFrames.delete(id);
    },

    /**
     * Cleanup all registered resources
     */
    cleanup: () => {
      // Call all registered cleanup functions
      cleanupManager.cleanupFunctions.forEach(fn => {
        try {
          fn();
        } catch (e) {
          logError('Cleanup', 'Cleanup function failed', e);
        }
      });
      cleanupManager.cleanupFunctions.clear();

      // Disconnect all observers
      cleanupManager.observers.forEach(obs => {
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
      cleanupManager.intervals.forEach(id => clearInterval(id));
      cleanupManager.intervals.clear();

      // Clear all timeouts
      cleanupManager.timeouts.forEach(id => clearTimeout(id));
      cleanupManager.timeouts.clear();

      // Cancel all animation frames
      cleanupManager.animationFrames.forEach(id => cancelAnimationFrame(id));
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
      return path.split('.').reduce((obj, key) => /** @type {any} */ (obj)?.[key], settings);
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
        /** @type {any} */ (obj)[key] = /** @type {any} */ (obj)[key] || {};
        return /** @type {any} */ (obj)[key];
      }, settings);
      /** @type {any} */ (target)[/** @type {string} */ (last)] = value;
      this.save(settings);
    },
  };

  /**
   * Style Manager
   * Centralized CSS injection and management
   */
  const StyleManager = {
    styles: new Map(),
    /** @type {HTMLStyleElement | null} */
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
    /** @type {any[]} */
    queue: [],
    activeNotifications: new Set(),
    maxVisible: 3,
    defaultDuration: 3000,

    /**
     * Show notification
     * @param {string} message - Notification message
     * @param {{duration?: number, position?: string | null, action?: {text: string, callback: Function} | null, type?: string}} [options] - Notification options
     * @returns {HTMLElement | null} Notification element
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
        duration = this.defaultDuration,
        position = null,
        action = null, // { text: string, callback: function }
      } = options;

      // Remove duplicate messages
      this.activeNotifications.forEach(notif => {
        if (notif.dataset.message === message) {
          this.remove(notif);
        }
      });

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
          style: {
            zIndex: '10001',
            width: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            ...(position && /** @type {any} */ (positions)[position]
              ? /** @type {any} */ (positions)[position]
              : {}),
          },
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

        // Ensure a centralized bottom-center container exists and add notification there
        const _notifContainerId = 'youtube-enhancer-notification-container';
        let _notifContainer = document.getElementById(_notifContainerId);
        if (!_notifContainer) {
          _notifContainer = createElement('div', {
            id: _notifContainerId,
            className: 'youtube-enhancer-notification-container',
          });
          try {
            document.body.appendChild(_notifContainer);
          } catch {
            // fallback to body append if container append fails
            document.body.appendChild(notification);
            this.activeNotifications.add(notification);
          }
        }

        try {
          // Prepend so newest notifications appear on top
          _notifContainer.insertBefore(notification, _notifContainer.firstChild);
        } catch {
          // fallback
          document.body.appendChild(notification);
        }
        // ensure notification accepts pointer events (container is pointer-events:none)
        try {
          notification.style.pointerEvents = 'auto';
        } catch {}
        this.activeNotifications.add(notification);

        // Apply entry animation from bottom
        try {
          notification.style.animation = 'slideInFromBottom 0.38s ease-out forwards';
        } catch {}

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
        try {
          notification.style.animation = 'slideOutToBottom 0.32s ease-in forwards';
          const timeoutId = setTimeout(() => {
            try {
              notification.remove();
              this.activeNotifications.delete(notification);
            } catch (e) {
              logError('NotificationManager', 'Failed to remove notification', e);
            }
          }, 340);
          cleanupManager.registerTimeout(timeoutId);
        } catch {
          // Fallback: immediate removal
          try {
            notification.remove();
            this.activeNotifications.delete(notification);
          } catch (e) {
            logError('NotificationManager', 'Failed to remove notification (fallback)', e);
          }
        }
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
      this.activeNotifications.forEach(notif => {
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

    @keyframes slideOutToBottom {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(100%); opacity: 0; }
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

  // Periodic cache cleanup to prevent memory leaks (using requestIdleCallback when available)
  const cacheCleanup = () => {
    const now = Date.now();
    for (const [key, value] of selectorCache.entries()) {
      if (!value.element?.isConnected || now - value.timestamp > CACHE_MAX_AGE) {
        selectorCache.delete(key);
      }
    }
  };

  const cacheCleanupInterval = setInterval(() => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(cacheCleanup, { timeout: 2000 });
    } else {
      cacheCleanup();
    }
  }, 30000); // Clean every 30 seconds

  cleanupManager.registerInterval(cacheCleanupInterval);

  // Global error handler for uncaught promise rejections
  window.addEventListener('unhandledrejection', event => {
    logError('Global', 'Unhandled promise rejection', event.reason);
    event.preventDefault(); // Prevent console spam
  });

  // Global error handler for uncaught errors
  window.addEventListener('error', event => {
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
    /** @this {any} */
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
    /** @this {any} */
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
        await new Promise(resolve => {
          setTimeout(resolve, delay * (i + 1));
        });
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
    t, // Translation function
  };
})();

// Make available globally
if (typeof window !== 'undefined') {
  // Merge utilities into existing global YouTubeUtils without overwriting
  /** @type {any} */ (window).YouTubeUtils = /** @type {any} */ (window).YouTubeUtils || {};
  const existing = /** @type {any} */ (window).YouTubeUtils;
  try {
    for (const k of Object.keys(YouTubeUtils)) {
      if (existing[k] === undefined) existing[k] = YouTubeUtils[k];
    }
  } catch {}

  // Add initialization health check (non-intrusive)
  window.YouTubeUtils &&
    YouTubeUtils.logger &&
    YouTubeUtils.logger.debug &&
    YouTubeUtils.logger.debug('[YouTube+ v2.4.1] Core utilities merged');

  // Expose debug info
  /** @type {any} */ (window).YouTubePlusDebug = {
    version: '2.4.1',
    cacheSize: () =>
      YouTubeUtils.cleanupManager.observers.size +
      YouTubeUtils.cleanupManager.listeners.size +
      YouTubeUtils.cleanupManager.intervals.size,
    clearAll: () => {
      YouTubeUtils.cleanupManager.cleanup();
      YouTubeUtils.clearCache();
      YouTubeUtils.StyleManager.clear();
      YouTubeUtils.NotificationManager.clearAll();
      window.YouTubeUtils &&
        YouTubeUtils.logger &&
        YouTubeUtils.logger.debug &&
        YouTubeUtils.logger.debug('[YouTube+] All resources cleared');
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
        YouTubeUtils.NotificationManager.show('YouTube+ v2.4.1 loaded', {
          type: 'success',
          duration: 2000,
          position: 'bottom-right',
        });
      }
    }, 1000);
  }
}
// YouTube enhancements module
(function () {
  'use strict';

  // Local reference to translation function
  const { t } = YouTubeUtils;

  const YouTubeEnhancer = {
    // Speed control variables
    speedControl: {
      currentSpeed: 1,
      activeAnimationId: null,
      storageKey: 'youtube_playback_speed',
    },

    _initialized: false,

    // Settings
    settings: {
      enableSpeedControl: true,
      enableScreenshot: true,
      enableDownload: true,

      // Basic: optional UI/style tweaks (style.js)
      enableZenStyles: true,
      zenStyles: {
        thumbnailHover: true,
        immersiveSearch: true,
        hideVoiceSearch: true,
        transparentHeader: true,
        hideSideGuide: false,
        cleanSideGuide: false,
        fixFeedLayout: true,
        betterCaptions: true,
        playerBlur: true,
      },

      // Enhanced features (advanced tab)
      enableEnhanced: true,
      enablePlayAll: true,
      enableResumeTime: true,
      enableZoom: true,
      enableThumbnail: true,
      enablePlaylistSearch: true,
      enableScrollToTopButton: true,

      // Состояние сайтов внутри сабменю кнопки Download (ytdl всегда включён)
      downloadSites: {
        direct: true,
        externalDownloader: true,
        ytdl: true,
      },
      // Настройки кастомизации download сайтов
      downloadSiteCustomization: {
        externalDownloader:
          typeof window !== 'undefined' && window.YouTubePlusConstants
            ? window.YouTubePlusConstants.DOWNLOAD_SITES.EXTERNAL_DOWNLOADER
            : { name: 'SSYouTube', url: 'https://ssyoutube.com/watch?v={videoId}' },
      },
      storageKey: 'youtube_plus_settings',
      // runtime setting: hide left side guide/footer when true
      hideSideGuide: false,
    },

    // Cache DOM queries
    _cache: new Map(),

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
        if (saved) {
          const parsed = JSON.parse(saved);
          // Use safeMerge to prevent prototype pollution
          if (window.YouTubeUtils && window.YouTubeUtils.safeMerge) {
            window.YouTubeUtils.safeMerge(this.settings, parsed);
          } else {
            // Fallback: manual safe copy
            for (const key in parsed) {
              if (
                Object.prototype.hasOwnProperty.call(parsed, key) &&
                !['__proto__', 'constructor', 'prototype'].includes(key)
              ) {
                this.settings[key] = parsed[key];
              }
            }
          }
          return;
        }

        // Migration: if no per-module settings found, try centralized SettingsManager storage
        try {
          if (
            typeof window !== 'undefined' &&
            window.YouTubeUtils &&
            YouTubeUtils.SettingsManager
          ) {
            const globalSettings = YouTubeUtils.SettingsManager.load();
            if (!globalSettings) return;

            // Map known flags (shallow mapping) to this.settings to preserve user's choices
            const sc = globalSettings.speedControl;
            if (sc && typeof sc.enabled === 'boolean') {
              this.settings.enableSpeedControl = sc.enabled;
            }

            const ss = globalSettings.screenshot;
            if (ss && typeof ss.enabled === 'boolean') this.settings.enableScreenshot = ss.enabled;

            const dl = globalSettings.download;
            if (dl && typeof dl.enabled === 'boolean') this.settings.enableDownload = dl.enabled;

            if (globalSettings.downloadSites && typeof globalSettings.downloadSites === 'object') {
              this.settings.downloadSites = {
                ...(this.settings.downloadSites || {}),
                ...globalSettings.downloadSites,
              };
            }
          }
        } catch {
          // best-effort migration; ignore failures
        }
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    },

    init() {
      if (this._initialized) {
        return;
      }

      this._initialized = true;

      try {
        this.loadSettings();
      } catch (error) {
        console.warn('[YouTube+][Basic]', 'Failed to load settings during init:', error);
      }

      this.insertStyles();
      this.addSettingsButtonToHeader();
      this.setupNavigationObserver();

      if (location.href.includes('watch?v=')) {
        this.setupCurrentPage();
      }

      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && location.href.includes('watch?v=')) {
          this.setupCurrentPage();
        }
      });

      // Keyboard shortcut: press 'S' to take a screenshot when not typing
      try {
        const screenshotKeyHandler = e => {
          // Only react to plain 's' key without modifiers
          if (!e || !e.key) return;
          if (!(e.key === 's' || e.key === 'S')) return;
          if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

          // Ignore when focus is on editable elements
          const active = document.activeElement;
          if (active) {
            const tag = (active.tagName || '').toLowerCase();
            if (
              tag === 'input' ||
              tag === 'textarea' ||
              tag === 'select' ||
              active.isContentEditable
            ) {
              return;
            }
          }

          if (!this.settings.enableScreenshot) return;

          try {
            this.captureFrame();
          } catch (err) {
            if (YouTubeUtils && YouTubeUtils.logError) {
              YouTubeUtils.logError('Basic', 'Keyboard screenshot failed', err);
            }
          }
        };

        YouTubeUtils.cleanupManager.registerListener(
          document,
          'keydown',
          screenshotKeyHandler,
          true
        );
      } catch (e) {
        if (YouTubeUtils && YouTubeUtils.logError) {
          YouTubeUtils.logError('Basic', 'Failed to register screenshot keyboard shortcut', e);
        }
      }
    },

    saveSettings() {
      localStorage.setItem(this.settings.storageKey, JSON.stringify(this.settings));
      this.updatePageBasedOnSettings();
      this.refreshDownloadButton();

      // Expose and broadcast updated settings so other modules can react live.
      try {
        window.youtubePlus = window.youtubePlus || {};
        window.youtubePlus.settings = this.settings;
        window.dispatchEvent(
          new CustomEvent('youtube-plus-settings-updated', {
            detail: this.settings,
          })
        );
      } catch {}
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

      // Also handle speed options dropdown (attached to body)
      const speedOptions = document.querySelector('.speed-options');
      if (speedOptions) {
        speedOptions.style.display = this.settings.enableSpeedControl ? '' : 'none';
      }
    },

    /**
     * Refresh download button visibility - Delegates to download-button module
     */
    refreshDownloadButton() {
      // Use extracted download button module
      if (typeof window !== 'undefined' && window.YouTubePlusDownloadButton) {
        const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
          settings: this.settings,
          t,
          getElement: this.getElement.bind(this),
          YouTubeUtils,
        });
        manager.refreshDownloadButton();
      }
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
      const styles = `:root{--yt-accent:#ff0000;--yt-accent-hover:#cc0000;--yt-radius-sm:6px;--yt-radius-md:10px;--yt-radius-lg:16px;--yt-transition:all .2s ease;--yt-space-xs:4px;--yt-space-sm:8px;  --yt-space-md:16px;--yt-space-lg:24px;--yt-glass-blur:blur(18px) saturate(180%);--yt-glass-blur-light:blur(12px) saturate(160%);--yt-glass-blur-heavy:blur(24px) saturate(200%);}
        html[dark],html:not([dark]):not([light]){--yt-bg-primary:rgba(15,15,15,.85);--yt-bg-secondary:rgba(28,28,28,.85);--yt-bg-tertiary:rgba(34,34,34,.85);--yt-text-primary:#fff;--yt-text-secondary:#aaa;--yt-border-color:rgba(255,255,255,.2);--yt-hover-bg:rgba(255,255,255,.1);--yt-shadow:0 4px 12px rgba(0,0,0,.25);--yt-glass-bg:rgba(255,255,255,.1);--yt-glass-border:rgba(255,255,255,.2);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.2);--yt-modal-bg:rgba(0,0,0,.75);--yt-notification-bg:rgba(28,28,28,.9);--yt-panel-bg:rgba(34,34,34,.3);--yt-header-bg:rgba(20,20,20,.6);--yt-input-bg:rgba(255,255,255,.1);--yt-button-bg:rgba(255,255,255,.2);--yt-text-stroke:white;}
        html[light]{--yt-bg-primary:rgba(255,255,255,.85);--yt-bg-secondary:rgba(248,248,248,.85);--yt-bg-tertiary:rgba(240,240,240,.85);--yt-text-primary:#030303;--yt-text-secondary:#606060;--yt-border-color:rgba(0,0,0,.2);--yt-hover-bg:rgba(0,0,0,.05);--yt-shadow:0 4px 12px rgba(0,0,0,.15);--yt-glass-bg:rgba(255,255,255,.7);--yt-glass-border:rgba(0,0,0,.1);--yt-glass-shadow:0 8px 32px rgba(0,0,0,.1);--yt-modal-bg:rgba(0,0,0,.5);--yt-notification-bg:rgba(255,255,255,.95);--yt-panel-bg:rgba(255,255,255,.7);--yt-header-bg:rgba(248,248,248,.8);--yt-input-bg:rgba(0,0,0,.05);--yt-button-bg:rgba(0,0,0,.1);--yt-text-stroke:#030303;}
        .ytp-screenshot-button,.ytp-cobalt-button,.ytp-pip-button{position:relative;width:44px;height:100%;display:inline-flex;align-items:center;justify-content:center;vertical-align:top;transition:opacity .15s,transform .15s;}
        .ytp-screenshot-button:hover,.ytp-cobalt-button:hover,.ytp-pip-button:hover{transform:scale(1.1);}
        .speed-control-btn{width:4em!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;text-align:center!important;border-radius:var(--yt-radius-sm);font-size:13px;color:var(--yt-text-primary);cursor:pointer;user-select:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;transition:color .2s;}
        .speed-control-btn:hover{color:var(--yt-accent);font-weight:bold;}
        .speed-options{position:fixed!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;border-radius:var(--yt-radius-md)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:0!important;transform:translate(-50%,12px)!important;width:92px!important;z-index:2147483647!important;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);opacity:0;pointer-events:none!important;transition:opacity .18s ease,transform .18s ease;box-sizing:border-box;}
        .speed-options.visible{opacity:1;pointer-events:auto!important;transform:translate(-50%,0)!important;}
        .speed-option-item{cursor:pointer!important;height:28px!important;line-height:28px!important;font-size:12px!important;text-align:center!important;transition:background-color .15s,color .15s;}
        .speed-option-active,.speed-option-item:hover{color:var(--yt-accent)!important;font-weight:bold!important;background:var(--yt-hover-bg)!important;}
        #speed-indicator{position:absolute!important;margin:auto!important;top:0!important;right:0!important;bottom:0!important;left:0!important;border-radius:24px!important;font-size:30px!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;z-index:99999!important;width:80px!important;height:80px!important;line-height:80px!important;text-align:center!important;display:none;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);}
        .youtube-enhancer-notification-container{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2147483647;pointer-events:none;max-width:calc(100% - 32px);width:100%;box-sizing:border-box;padding:0 16px;}
        .youtube-enhancer-notification{position:relative;max-width:700px;width:auto;background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:8px 14px;font-size:13px;border-radius:var(--yt-radius-md);z-index:inherit;transition:opacity .35s,transform .32s;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur); -webkit-backdrop-filter:var(--yt-glass-blur);font-weight:500;box-sizing:border-box;display:flex;align-items:center;gap:10px;pointer-events:auto;}
        .ytp-plus-settings-button{background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;padding:var(--yt-space-sm);margin-right:var(--yt-space-sm);border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background-color .2s,transform .2s;}
        .ytp-plus-settings-button svg{width:24px;height:24px;}
        .ytp-plus-settings-button:hover{background:var(--yt-hover-bg);transform:rotate(30deg);color:var(--yt-text-secondary);}
        .ytp-plus-settings-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:100000;backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);animation:ytEnhanceFadeIn .25s ease-out;contain:layout style paint;}
        .ytp-plus-settings-panel{background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:20px;width:760px;max-width:94%;max-height:60vh;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.45);animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);border:1.5px solid var(--yt-glass-border);will-change:transform,opacity;display:flex;flex-direction:row;contain:layout style paint;}
        .ytp-plus-settings-sidebar{width:240px;background:var(--yt-header-bg);border-right:1px solid var(--yt-glass-border);display:flex;flex-direction:column;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
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
        .ytp-plus-settings-section.hidden{display:none !important;}
        .ytp-plus-settings-item{display:flex;align-items:center;margin-bottom:var(--yt-space-md);padding:14px 18px;background:transparent;transition:all .25s cubic-bezier(.4,0,.2,1);border-radius:var(--yt-radius-md);}
        .ytp-plus-settings-item:hover{background:var(--yt-hover-bg);transform:translateX(6px);box-shadow:0 2px 8px rgba(0,0,0,.1);}
        .ytp-plus-settings-item-actions{display:flex;align-items:center;gap:10px;margin-left:auto;}
        .ytp-plus-submenu-toggle{width:26px;height:26px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:pointer;opacity:.9;transition:transform .15s ease,background-color .15s ease,opacity .15s ease;}
        .ytp-plus-submenu-toggle:hover{background:var(--yt-hover-bg);transform:scale(1.06);}
        .ytp-plus-submenu-toggle:disabled{opacity:.35;cursor:not-allowed;transform:none;}
        .ytp-plus-submenu-toggle svg{width:16px;height:16px;transition:transform .15s ease;}
        .ytp-plus-submenu-toggle[aria-expanded="false"] svg{transform:rotate(-90deg);}
        .ytp-plus-submenu-toggle[aria-expanded="true"] svg{transform:rotate(0deg);}
        .ytp-plus-settings-item-label{flex:1;font-size:14px;color:var(--yt-text-primary);}
        .ytp-plus-settings-item-description{font-size:12px;color:var(--yt-text-secondary);margin-top:4px;}
        .ytp-plus-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;min-width:20px;min-height:20px;margin-left:auto;border:2px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:all 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:#fff;box-sizing:border-box;}
        html:not([dark]) .ytp-plus-settings-checkbox{border-color:rgba(0,0,0,.25);color:#222;}
        .ytp-plus-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
        .ytp-plus-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
        .ytp-plus-settings-checkbox::before{content:"";width:5px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:6px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:11px;left:7px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
        .ytp-plus-settings-checkbox:checked{transform:rotate(0deg) scale(1.15);}
        .ytp-plus-settings-checkbox:checked::before{width:9px;opacity:1;background:#fff;transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
        .ytp-plus-settings-checkbox:checked::after{width:16px;opacity:1;background:#fff;transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
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
        .ytp-plus-settings-item{padding:10px 12px;}}
        .ytp-plus-settings-section h1{margin:-95px 90px 8px;font-family:'Montserrat',sans-serif;font-size:52px;font-weight:600;color:transparent;-webkit-text-stroke-width:1px;-webkit-text-stroke-color:var(--yt-text-stroke);cursor:pointer;transition:color .2s;}
        .ytp-plus-settings-section h1:hover{color:var(--yt-accent);-webkit-text-stroke-width:1px;-webkit-text-stroke-color:transparent;}
        .download-options{position:fixed;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-md);width:150px;z-index:2147483647;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;transform:translateY(8px);box-sizing:border-box;}
        .download-options.visible{opacity:1;pointer-events:auto;transform:translateY(0);}
        .download-options-list{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;}
        .download-option-item{cursor:pointer;padding:12px;text-align:center;transition:background .2s,color .2s;width:100%;}
        .download-option-item:hover{background:var(--yt-hover-bg);color:var(--yt-accent);}
        .ytp-download-button{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;padding:0 10px!important;cursor:pointer!important;}
        .glass-panel{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow);}
        .glass-card{background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-md);backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);box-shadow:var(--yt-shadow);}
        .glass-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .glass-button{background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-sm) var(--yt-space-md);color:var(--yt-text-primary);cursor:pointer;transition:all .2s ease;backdrop-filter:var(--yt-glass-blur-light);-webkit-backdrop-filter:var(--yt-glass-blur-light);}
        .glass-button:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .download-submenu{margin:4px 0 12px 12px;}
        .download-submenu-container{display:flex;flex-direction:column;gap:8px;}
        .style-submenu{margin:4px 0 12px 12px;}
        .style-submenu-container{display:flex;flex-direction:column;gap:8px;}
        .download-site-option{display:flex;flex-direction:column;align-items:stretch;gap:8px;padding:10px;border-radius:var(--yt-radius-md);transition:background .2s;}
        .download-site-option:hover{background:var(--yt-hover-bg);}
        .download-site-header{display:flex;flex-direction:row;align-items:center;justify-content:space-between;width:100%;gap:12px;}
        .download-site-label{flex:1;cursor:pointer;display:flex;flex-direction:column;}
        .download-site-controls{width:100%;margin-top:4px;padding-top:10px;border-top:1px solid var(--yt-glass-border);}
        .download-site-input{width:95%;margin-top:8px;padding:8px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-sm);color:var(--yt-text-primary);font-size:13px;transition:all .2s;}
        .download-site-input:focus{border-color:var(--yt-accent);background:var(--yt-hover-bg);}
        .download-site-input.small{margin-top:6px;font-size:12px;}
        .download-site-cta{display:flex;flex-direction:row;gap:8px;margin-top:10px;}
        .download-site-cta .glass-button{flex:1;justify-content:center;font-size:13px;padding:8px 12px;}
        .download-site-cta .glass-button.danger{background:rgba(255,59,59,0.15);border-color:rgba(255,59,59,0.3);}
        .download-site-cta .glass-button.danger:hover{background:rgba(255,59,59,0.25);}
        .download-site-option .ytp-plus-settings-checkbox{margin:0;}
        .download-site-name{font-weight:500;font-size:15px;color:var(--yt-text-primary);}
        .download-site-desc{font-size:12px;color:var(--yt-text-secondary);margin-top:2px;opacity:0.8;}
        /* Ensure custom YouTube searchbox input backgrounds are transparent to match theme */
        .ytSearchboxComponentInputBox { background: transparent !important; }
        /* Fix native select/option contrast inside settings modal */
        .ytp-plus-settings-panel select,
        .ytp-plus-settings-panel select option {background: var(--yt-panel-bg) !important; color: var(--yt-text-primary) !important;}
        /* Improve select appearance and ensure options are legible */
        .ytp-plus-settings-panel select {-webkit-appearance: menulist !important; appearance: menulist !important; padding: 6px 8px !important; border-radius: 6px !important; border: 1px solid var(--yt-glass-border) !important;}
        /* Shared glass-dropdown styles used by settings components */
        .glass-dropdown{position:relative;display:inline-block;min-width:110px}
        .glass-dropdown__toggle{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:6px 8px;border-radius:8px;background:linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));color:inherit;border:1px solid rgba(255,255,255,0.06);backdrop-filter:blur(8px) saturate(120%);-webkit-backdrop-filter:blur(8px) saturate(120%);cursor:pointer}
        .glass-dropdown__toggle:focus{outline:2px solid rgba(255,255,255,0.06)}
        .glass-dropdown__label{font-size:12px}
        .glass-dropdown__chev{opacity:0.9}
        .glass-dropdown__list{position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:20000;display:none;margin:0;padding:6px;border-radius:10px;list-style:none;background:var(--yt-header-bg);border:1px solid rgba(255,255,255,0.06);box-shadow:0 8px 30px rgba(0,0,0,0.5);backdrop-filter:blur(10px) saturate(130%);-webkit-backdrop-filter:blur(10px) saturate(130%);max-height:220px;overflow:auto}
        .glass-dropdown__item{padding:8px 10px;border-radius:6px;margin:4px 0;cursor:pointer;color:inherit;font-size:13px}
        .glass-dropdown__item:hover{background:rgba(255,255,255,0.04)}
        .glass-dropdown__item[aria-selected="true"]{background:linear-gradient(90deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));box-shadow:inset 0 0 0 1px rgba(255,255,255,0.02)}
        `;

      if (!document.getElementById('yt-enhancer-styles')) {
        YouTubeUtils.StyleManager.add('yt-enhancer-main', styles);
      }
    },

    addSettingsButtonToHeader() {
      this.waitForElement('ytd-masthead #end', 5000)
        .then(headerEnd => {
          if (!this.getElement('.ytp-plus-settings-button')) {
            const settingsButton = document.createElement('div');
            settingsButton.className = 'ytp-plus-settings-button';
            settingsButton.setAttribute('title', t('youtubeSettings'));
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

    /**
     * Handle modal click actions (extracted to reduce complexity)
     * @param {HTMLElement} target - Click target
     * @param {HTMLElement} modal - Modal element
     * @param {Object} handlers - Modal handlers
     * @param {Function} markDirty - Mark dirty function
     * @param {Object} context - Context object
     * @param {Function} translate - Translation function
     */
    handleModalClickActions(target, modal, handlers, markDirty, context, translate) {
      // Sidebar navigation
      const navItem = /** @type {HTMLElement | null} */ (
        target.classList && target.classList.contains('ytp-plus-settings-nav-item')
          ? target
          : target.closest && target.closest('.ytp-plus-settings-nav-item')
      );
      if (navItem) {
        handlers.handleSidebarNavigation(navItem, modal);
        return;
      }

      // Save button
      if (target.id === 'ytp-plus-save-settings' || target.id === 'ytp-plus-save-settings-icon') {
        this.saveSettings();
        modal.remove();
        this.showNotification(translate('settingsSaved'));
        return;
      }

      // External downloader save
      if (target.id === 'download-externalDownloader-save') {
        handlers.handleExternalDownloaderSave(
          target,
          this.settings,
          this.saveSettings.bind(this),
          this.showNotification.bind(this),
          translate
        );
        return;
      }

      // External downloader reset
      if (target.id === 'download-externalDownloader-reset') {
        handlers.handleExternalDownloaderReset(
          modal,
          this.settings,
          this.saveSettings.bind(this),
          this.showNotification.bind(this),
          translate
        );
      }
    },

    createSettingsModal() {
      const modal = document.createElement('div');
      modal.className = 'ytp-plus-settings-modal';

      // Use helper functions from settings-helpers.js
      const helpers = window.YouTubePlusSettingsHelpers;
      const handlers = window.YouTubePlusModalHandlers;
      modal.innerHTML = `<div class="ytp-plus-settings-panel">${helpers.createSettingsSidebar(t)}${helpers.createMainContent(this.settings, t)}</div>`;

      // Track unsaved changes
      let dirty = false;
      const saveIconBtn = modal.querySelector('#ytp-plus-save-settings-icon');
      if (saveIconBtn) saveIconBtn.style.display = 'none';
      const markDirty = () => {
        if (dirty) return;
        dirty = true;
        if (saveIconBtn) saveIconBtn.style.display = '';
      };

      // Context for handlers
      const context = {
        settings: this.settings,
        getElement: this.getElement.bind(this),
        addDownloadButton: this.addDownloadButton.bind(this),
        addSpeedControlButton: this.addSpeedControlButton.bind(this),
        refreshDownloadButton: this.refreshDownloadButton.bind(this),
        updatePageBasedOnSettings: this.updatePageBasedOnSettings.bind(this),
      };

      // Create click handler
      const handleModalClick = e => {
        const { target } = /** @type {{ target: HTMLElement }} */ (e);

        // Submenu toggle buttons (e.g., YouTube Music)
        const submenuToggleBtn = target.closest('.ytp-plus-submenu-toggle');
        if (submenuToggleBtn) {
          try {
            if (
              submenuToggleBtn instanceof HTMLElement &&
              submenuToggleBtn.tagName === 'BUTTON' &&
              submenuToggleBtn.hasAttribute('disabled')
            ) {
              return;
            }
            const submenuKey = submenuToggleBtn.dataset?.submenu;
            if (!submenuKey) return;
            const panel = submenuToggleBtn.closest('.ytp-plus-settings-panel');
            if (!panel) return;
            const submenuSelector =
              submenuKey === 'music'
                ? `.music-submenu[data-submenu="${submenuKey}"]`
                : submenuKey === 'download'
                  ? `.download-submenu[data-submenu="${submenuKey}"]`
                  : submenuKey === 'style'
                    ? `.style-submenu[data-submenu="${submenuKey}"]`
                    : submenuKey === 'pip'
                      ? `.pip-submenu[data-submenu="${submenuKey}"]`
                      : submenuKey === 'timecode'
                        ? `.timecode-submenu[data-submenu="${submenuKey}"]`
                        : submenuKey === 'enhanced'
                          ? `.enhanced-submenu[data-submenu="${submenuKey}"]`
                          : `[data-submenu="${submenuKey}"]`;
            const submenuEl = panel.querySelector(submenuSelector);
            if (!(submenuEl instanceof HTMLElement)) return;

            const computedDisplay = window.getComputedStyle(submenuEl).display;
            const currentlyHidden = computedDisplay === 'none' || submenuEl.hidden;
            const nextHidden = !currentlyHidden;
            submenuEl.style.display = nextHidden ? 'none' : '';
            submenuToggleBtn.setAttribute('aria-expanded', nextHidden ? 'false' : 'true');

            // Persist submenu expanded state to localStorage
            try {
              const submenuStates = JSON.parse(
                localStorage.getItem('ytp-plus-submenu-states') || '{}'
              );
              submenuStates[submenuKey] = !nextHidden;
              localStorage.setItem('ytp-plus-submenu-states', JSON.stringify(submenuStates));
            } catch {
              // Ignore storage errors
            }
          } catch {}
          return;
        }

        // Close modal
        if (target === modal) {
          modal.remove();
          return;
        }

        // Close button
        if (
          target.id === 'ytp-plus-close-settings' ||
          target.id === 'ytp-plus-close-settings-icon' ||
          target.classList.contains('ytp-plus-settings-close') ||
          target.closest('.ytp-plus-settings-close') ||
          target.closest('#ytp-plus-close-settings') ||
          target.closest('#ytp-plus-close-settings-icon')
        ) {
          modal.remove();
          return;
        }

        // YTDL GitHub button
        if (target.id === 'open-ytdl-github' || target.closest('#open-ytdl-github')) {
          window.open('https://github.com/diorhc/YTDL', '_blank');
          return;
        }

        // Handle different actions
        this.handleModalClickActions(target, modal, handlers, markDirty, context, t);
      };

      modal.addEventListener('click', handleModalClick);

      // Change event delegation for checkboxes
      modal.addEventListener('change', e => {
        const { target } = /** @type {{ target: EventTarget & HTMLElement }} */ (e);
        if (!target.classList.contains('ytp-plus-settings-checkbox')) return;

        const { dataset } = /** @type {HTMLElement} */ (target);
        const { setting } = dataset;
        if (!setting) return;

        // Download site checkboxes
        if (setting.startsWith('downloadSite_')) {
          const key = setting.replace('downloadSite_', '');
          handlers.handleDownloadSiteToggle(
            target,
            key,
            this.settings,
            markDirty,
            this.saveSettings.bind(this)
          );
          return;
        }

        // YouTube Music settings - handle separately
        if (handlers.isMusicSetting && handlers.isMusicSetting(setting)) {
          handlers.handleMusicSettingToggle(target, setting, this.showNotification.bind(this), t);
          return;
        }

        // Simple settings
        handlers.handleSimpleSettingToggle(
          target,
          setting,
          this.settings,
          context,
          markDirty,
          this.saveSettings.bind(this),
          modal
        );
      });

      // Input event delegation
      modal.addEventListener('input', e => {
        const { target } = /** @type {{ target: EventTarget & HTMLElement }} */ (e);
        if (target.classList.contains('download-site-input')) {
          const { dataset } = /** @type {HTMLElement} */ (target);
          const { site, field } = dataset;
          if (!site || !field) return;
          handlers.handleDownloadSiteInput(target, site, field, this.settings, markDirty, t);
        }
      });

      // Allow report module to populate settings
      try {
        if (
          typeof window !== 'undefined' &&
          /** @type {any} */ (window).youtubePlusReport &&
          typeof (/** @type {any} */ (window).youtubePlusReport.render) === 'function'
        ) {
          try {
            /** @type {any} */ (window).youtubePlusReport.render(modal);
          } catch (e) {
            YouTubeUtils.logError('Report', 'report.render failed', e);
          }
        }
      } catch (e) {
        YouTubeUtils.logError('Report', 'Failed to initialize report section', e);
      }

      // Restore submenu expanded states from localStorage
      try {
        const submenuStates = JSON.parse(localStorage.getItem('ytp-plus-submenu-states') || '{}');
        Object.entries(submenuStates).forEach(([key, expanded]) => {
          const toggleBtn = modal.querySelector(`.ytp-plus-submenu-toggle[data-submenu="${key}"]`);
          if (toggleBtn instanceof HTMLElement && !toggleBtn.hasAttribute('disabled')) {
            const submenuSelector =
              key === 'music'
                ? `.music-submenu[data-submenu="${key}"]`
                : key === 'download'
                  ? `.download-submenu[data-submenu="${key}"]`
                  : key === 'style'
                    ? `.style-submenu[data-submenu="${key}"]`
                    : key === 'pip'
                      ? `.pip-submenu[data-submenu="${key}"]`
                      : key === 'timecode'
                        ? `.timecode-submenu[data-submenu="${key}"]`
                        : key === 'enhanced'
                          ? `.enhanced-submenu[data-submenu="${key}"]`
                          : `[data-submenu="${key}"]`;
            const submenuEl = modal.querySelector(submenuSelector);
            if (submenuEl instanceof HTMLElement) {
              const isExpanded = !!expanded;
              submenuEl.style.display = isExpanded ? '' : 'none';
              toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            }
          }
        });
      } catch {
        // Ignore storage errors
      }

      // Restore active nav section from localStorage
      try {
        const savedSection = localStorage.getItem('ytp-plus-active-nav-section');
        if (savedSection) {
          const navItem = modal.querySelector(
            `.ytp-plus-settings-nav-item[data-section="${savedSection}"]`
          );
          if (navItem) {
            modal
              .querySelectorAll('.ytp-plus-settings-nav-item')
              .forEach(item => item.classList.remove('active'));
            modal
              .querySelectorAll('.ytp-plus-settings-section')
              .forEach(s => s.classList.add('hidden'));
            navItem.classList.add('active');
            const targetSection = modal.querySelector(
              `.ytp-plus-settings-section[data-section="${savedSection}"]`
            );
            if (targetSection) targetSection.classList.remove('hidden');
          }
        }
      } catch {
        // Ignore storage errors
      }

      return modal;
    },

    openSettingsModal() {
      const existingModal = this.getElement('.ytp-plus-settings-modal', false);
      if (existingModal) existingModal.remove();
      document.body.appendChild(this.createSettingsModal());
      // Notify modules that settings modal is now in DOM
      try {
        document.dispatchEvent(
          new CustomEvent('youtube-plus-settings-modal-opened', { bubbles: true })
        );
      } catch {
        // ignore event dispatch errors
      }
    },

    waitForElement(selector, timeout = 5000) {
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
      button.setAttribute('title', t('takeScreenshot'));
      button.innerHTML = `
          <svg width="24" height="24" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19.83,8.77l-2.77,2.84H6.29A1.79,1.79,0,0,0,4.5,13.4V36.62a1.8,1.8,0,0,0,1.79,1.8H41.71a1.8,1.8,0,0,0,1.79-1.8V13.4a1.79,1.79,0,0,0-1.79-1.79H30.94L28.17,8.77Zm18.93,5.74a1.84,1.84,0,1,1,0,3.68A1.84,1.84,0,0,1,38.76,14.51ZM24,17.71a8.51,8.51,0,1,1-8.51,8.51A8.51,8.51,0,0,1,24,17.71Z"/>
          </svg>
        `;
      button.addEventListener('click', this.captureFrame.bind(this));
      controls.insertBefore(button, controls.firstChild);
    },

    /**
     * Add download button to controls - Delegates to download-button module
     * @param {HTMLElement} controls - Controls container
     */
    addDownloadButton(controls) {
      // Use extracted download button module
      if (typeof window !== 'undefined' && window.YouTubePlusDownloadButton) {
        const manager = window.YouTubePlusDownloadButton.createDownloadButtonManager({
          settings: this.settings,
          t,
          getElement: this.getElement.bind(this),
          YouTubeUtils,
        });
        manager.addDownloadButton(controls);
      } else {
        console.warn('[YouTube+] Download button module not loaded');
      }
    },

    addSpeedControlButton(controls) {
      // Check if speed control is enabled in settings
      if (!this.settings.enableSpeedControl) return;

      const speedBtn = document.createElement('button');
      speedBtn.type = 'button';
      speedBtn.className = 'ytp-button speed-control-btn';
      speedBtn.setAttribute('aria-label', t('speedControl'));
      speedBtn.setAttribute('aria-haspopup', 'true');
      speedBtn.setAttribute('aria-expanded', 'false');
      speedBtn.innerHTML = `<span>${this.speedControl.currentSpeed}×</span>`;

      const speedOptions = document.createElement('div');
      speedOptions.className = 'speed-options';
      speedOptions.setAttribute('role', 'menu');

      const selectSpeed = speed => {
        this.changeSpeed(speed);
        hideDropdown();
      };

      [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0].forEach(speed => {
        const option = document.createElement('div');
        option.className = `speed-option-item${Number(speed) === this.speedControl.currentSpeed ? ' speed-option-active' : ''}`;
        option.textContent = `${speed}x`;
        option.dataset.speed = String(speed);
        option.setAttribute('role', 'menuitem');
        option.tabIndex = 0;
        option.addEventListener('click', () => selectSpeed(speed));
        option.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectSpeed(speed);
          }
        });
        speedOptions.appendChild(option);
      });

      speedBtn.appendChild(speedOptions);

      // Ensure only one speed dropdown exists
      const existingSpeed = document.querySelector('.speed-options');
      if (existingSpeed) existingSpeed.remove();

      // Append speedOptions to body to avoid Firefox positioning/hover issues
      try {
        document.body.appendChild(speedOptions);
      } catch {
        // fallback keep as child
      }

      const positionDropdown = () => {
        const rect = speedBtn.getBoundingClientRect();
        speedOptions.style.left = `${rect.left + rect.width / 2}px`;
        speedOptions.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      };

      const hideDropdown = () => {
        speedOptions.classList.remove('visible');
        speedBtn.setAttribute('aria-expanded', 'false');
      };

      const showDropdown = () => {
        positionDropdown();
        speedOptions.classList.add('visible');
        speedBtn.setAttribute('aria-expanded', 'true');
      };

      const toggleDropdown = () => {
        if (speedOptions.classList.contains('visible')) {
          hideDropdown();
        } else {
          showDropdown();
        }
      };

      let documentClickKey;

      const documentClickHandler = event => {
        if (!speedBtn.isConnected) {
          if (documentClickKey) {
            YouTubeUtils.cleanupManager.unregisterListener(documentClickKey);
            documentClickKey = undefined;
          }
          return;
        }
        if (!speedOptions.classList.contains('visible')) return;
        if (
          speedBtn.contains(/** @type {Node} */ (event.target)) ||
          speedOptions.contains(/** @type {Node} */ (event.target))
        ) {
          return;
        }
        hideDropdown();
      };

      const documentKeydownHandler = event => {
        if (event.key === 'Escape' && speedOptions.classList.contains('visible')) {
          hideDropdown();
          speedBtn.focus();
        }
      };

      documentClickKey = YouTubeUtils.cleanupManager.registerListener(
        document,
        'click',
        documentClickHandler,
        true
      );
      YouTubeUtils.cleanupManager.registerListener(
        document,
        'keydown',
        documentKeydownHandler,
        true
      );

      YouTubeUtils.cleanupManager.registerListener(window, 'resize', () => {
        if (speedOptions.classList.contains('visible')) {
          positionDropdown();
        }
      });

      YouTubeUtils.cleanupManager.registerListener(
        window,
        'scroll',
        () => {
          if (speedOptions.classList.contains('visible')) {
            positionDropdown();
          }
        },
        true
      );

      // Hover behaviour: show on mouseenter, hide on mouseleave (with small delay)
      let speedHideTimer;
      speedBtn.addEventListener('mouseenter', () => {
        clearTimeout(speedHideTimer);
        showDropdown();
      });
      speedBtn.addEventListener('mouseleave', () => {
        clearTimeout(speedHideTimer);
        speedHideTimer = setTimeout(hideDropdown, 200);
      });
      speedOptions.addEventListener('mouseenter', () => {
        clearTimeout(speedHideTimer);
        showDropdown();
      });
      speedOptions.addEventListener('mouseleave', () => {
        clearTimeout(speedHideTimer);
        speedHideTimer = setTimeout(hideDropdown, 200);
      });

      // Keep keyboard support (Enter toggles dropdown)
      speedBtn.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleDropdown();
        } else if (event.key === 'Escape') {
          hideDropdown();
        }
      });

      controls.insertBefore(speedBtn, controls.firstChild);
    },

    // ------------------ Side Guide Toggle ------------------
    applyGuideVisibility() {
      try {
        const enabled = Boolean(YouTubeUtils.storage.get('ytplus.hideGuide', false));
        document.documentElement.classList.toggle('ytp-hide-guide', enabled);
        // update floating button appearance if present
        const btn = document.getElementById('ytplus-guide-toggle-btn');
        if (btn) {
          btn.setAttribute('aria-pressed', String(enabled));
          btn.title = enabled ? 'Show side guide' : 'Hide side guide';
        }
      } catch (e) {
        console.warn('[YouTube+] applyGuideVisibility failed:', e);
      }
    },

    toggleSideGuide() {
      try {
        const current = Boolean(YouTubeUtils.storage.get('ytplus.hideGuide', false));
        const next = !current;
        YouTubeUtils.storage.set('ytplus.hideGuide', next);
        this.applyGuideVisibility();
      } catch (e) {
        console.warn('[YouTube+] toggleSideGuide failed:', e);
      }
    },

    createGuideToggleButton() {
      try {
        if (document.getElementById('ytplus-guide-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'ytplus-guide-toggle-btn';
        btn.type = 'button';
        btn.style.cssText =
          'position:fixed;right:12px;bottom:12px;z-index:100000;background:var(--yt-spec-call-to-action);color:#fff;border:none;border-radius:8px;padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,0.3);cursor:pointer;opacity:0.95;font-size:13px;';
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Hide side guide';
        btn.textContent = 'Toggle Guide';
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.toggleSideGuide();
        });

        // keyboard support
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.toggleSideGuide();
          }
        });

        document.body.appendChild(btn);
        // Apply current stored value
        this.applyGuideVisibility();
      } catch (e) {
        console.warn('[YouTube+] createGuideToggleButton failed:', e);
      }
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
      try {
        link.click();

        // Notify success (use translation if available)
        try {
          const translated = typeof t === 'function' ? t('screenshotSaved') : null;
          const message =
            translated && translated !== 'screenshotSaved' ? translated : 'Screenshot saved';
          this.showNotification(message, 2000);
        } catch {
          this.showNotification('Screenshot saved', 2000);
        }
      } catch (err) {
        if (YouTubeUtils && YouTubeUtils.logError) {
          YouTubeUtils.logError('Basic', 'Screenshot download failed', err);
        }
        try {
          const translatedFail = typeof t === 'function' ? t('screenshotFailed') : null;
          const failMsg =
            translatedFail && translatedFail !== 'screenshotFailed'
              ? translatedFail
              : 'Screenshot failed';
          this.showNotification(failMsg, 3000);
        } catch {
          this.showNotification('Screenshot failed', 3000);
        }
      }
    },

    showNotification(message, duration = 2000) {
      YouTubeUtils.NotificationManager.show(message, { duration, type: 'info' });
    },

    handleFullscreenChange() {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      document.querySelectorAll('.ytp-screenshot-button, .ytp-cobalt-button').forEach(button => {
        button.style.bottom = isFullscreen ? '0px' : '0px';
      });
    },

    changeSpeed(speed) {
      const numericSpeed = Number(speed);
      this.speedControl.currentSpeed = numericSpeed;
      localStorage.setItem(this.speedControl.storageKey, String(numericSpeed));

      const speedBtn = this.getElement('.speed-control-btn span', false);
      if (speedBtn) speedBtn.textContent = `${numericSpeed}×`;

      document.querySelectorAll('.speed-option-item').forEach(option => {
        option.classList.toggle(
          'speed-option-active',
          parseFloat(option.dataset.speed) === numericSpeed
        );
      });

      this.applyCurrentSpeed();
      this.showSpeedIndicator(numericSpeed);
    },

    applyCurrentSpeed() {
      document.querySelectorAll('video').forEach(video => {
        if (video && video.playbackRate !== this.speedControl.currentSpeed) {
          video.playbackRate = this.speedControl.currentSpeed;
        }
      });
    },

    setupVideoObserver() {
      if (this._speedInterval) clearInterval(this._speedInterval);
      this._speedInterval = null;

      // Event-driven speed control instead of polling every 1s
      const applySpeed = () => this.applyCurrentSpeed();
      const attachSpeedListeners = video => {
        if (video._ytpSpeedListenerAttached) return;
        video._ytpSpeedListenerAttached = true;
        video.addEventListener('loadedmetadata', applySpeed);
        video.addEventListener('playing', applySpeed);
        video.addEventListener('ratechange', () => {
          if (video.playbackRate !== this.speedControl.currentSpeed) {
            video.playbackRate = this.speedControl.currentSpeed;
          }
        });
        applySpeed();
      };

      // Attach to existing videos
      document.querySelectorAll('video').forEach(attachSpeedListeners);

      // Watch for new video elements
      const videoObserver = new MutationObserver(mutations => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeName === 'VIDEO') attachSpeedListeners(node);
            if (node instanceof Element) {
              node.querySelectorAll?.('video').forEach(attachSpeedListeners);
            }
          }
        }
      });
      if (document.body) {
        videoObserver.observe(document.body, { childList: true, subtree: true });
      }
      YouTubeUtils.cleanupManager.registerObserver(videoObserver);
    },

    setupNavigationObserver() {
      let lastUrl = location.href;

      document.addEventListener('fullscreenchange', this.handleFullscreenChange.bind(this));

      document.addEventListener('yt-navigate-finish', () => {
        if (location.href.includes('watch?v=')) this.setupCurrentPage();
        this.addSettingsButtonToHeader();
      });

      // Use popstate + pushState/replaceState override for SPA navigation fallback
      // instead of expensive body subtree MutationObserver
      const checkUrlChange = () => {
        if (lastUrl !== location.href) {
          lastUrl = location.href;
          if (location.href.includes('watch?v=')) {
            setTimeout(() => this.setupCurrentPage(), 500);
          }
          this.addSettingsButtonToHeader();
        }
      };

      window.addEventListener('popstate', checkUrlChange);
      document.addEventListener('yt-navigate-start', checkUrlChange);
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

      const startTime = performance.now();
      const fadeOut = timestamp => {
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / 1500, 1);

        indicator.style.opacity = String(0.8 * (1 - progress));

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

  // Save reference to init function BEFORE IIFE closes (critical for DOMContentLoaded)
  const initFunction = YouTubeEnhancer.init.bind(YouTubeEnhancer);

  // Initialize immediately or on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFunction);
  } else {
    initFunction();
  }
})();
