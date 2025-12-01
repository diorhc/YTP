/**
 * @fileoverview Helper utilities to reduce code complexity in main.js
 * @description Provides extracted helper functions for complex operations
 * @version 2.2
 */

(function () {
  'use strict';

  /**
   * DOM Helper utilities for safer DOM manipulation
   * @namespace DOMHelpers
   */
  const DOMHelpers = {
    /**
     * Safely query an element with error handling
     * @param {Element} parent - Parent element to query from
     * @param {string} selector - CSS selector
     * @returns {Element|null} Found element or null
     */
    safeQuery(parent, selector) {
      try {
        if (!parent || typeof parent.querySelector !== 'function') return null;
        return parent.querySelector(selector);
      } catch (error) {
        console.warn('[YouTube+][DOMHelpers] Query failed:', selector, error);
        return null;
      }
    },

    /**
     * Internal helper: scroll option into view if needed
     */
    _scrollIntoViewIfNeeded(list, node) {
      try {
        if (!node || !list) return;
        const nrect = node.getBoundingClientRect();
        const lrect = list.getBoundingClientRect();
        if (nrect.top < lrect.top) node.scrollIntoView(true);
        else if (nrect.bottom > lrect.bottom) node.scrollIntoView(false);
      } catch {}
    },

    /**
     * Internal helper: build an option node for custom select
     */
    _buildCustomSelectItem(root, list, opt, id) {
      const item = document.createElement('div');
      let useId;
      if (typeof id === 'undefined') {
        root._idCounter = (root._idCounter || 0) + 1;
        useId = root._idCounter;
      } else {
        useId = id;
      }
      item.id = `ytp-plus-custom-opt-${Date.now()}-${useId}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.textContent = opt.text;
      item.dataset.value = String(opt.value);
      Object.assign(item.style, {
        padding: '8px 10px',
        cursor: 'pointer',
        borderBottom: '1px solid rgba(255,255,255,0.02)',
        color: 'inherit',
      });
      item.addEventListener('click', e => {
        e.stopPropagation();
        const idx = Array.prototype.indexOf.call(list.children, item);
        const selFn = root._selectIndexFn;
        if (typeof selFn === 'function') selFn(idx);
      });
      item.addEventListener('mouseenter', () => {
        const idx = Array.prototype.indexOf.call(list.children, item);
        const hlFn = root._highlightFn;
        if (typeof hlFn === 'function') hlFn(idx);
      });
      return item;
    },

    /**
     * Populate options for a custom select
     */
    _setCustomSelectOptions(root, list, options) {
      root._options = Array.isArray(options) ? options : [];
      list.innerHTML = '';
      root._activeIndex = -1;
      for (let i = 0; i < root._options.length; i++) {
        const opt = root._options[i];
        const item = DOMHelpers._buildCustomSelectItem(root, list, opt);
        list.appendChild(item);
      }
      if (root._options.length > 0) {
        root.value = root._options[0].value;
      } else {
        root._value = '';
        const lbl = root.querySelector('.ytp-plus-custom-select-label');
        if (lbl) lbl.textContent = '';
      }
    },

    /**
     * Create a keydown handler factory for the custom select to keep createCustomSelect short
     */
    _makeCustomSelectKeyHandler(root, list, openFn, closeFn, highlightFn, selectFn) {
      return function (e) {
        if (root._disabled) return;
        const { key } = e;
        const len = root._options.length;
        if (key === 'ArrowDown') {
          e.preventDefault();
          if (list.style.display === 'none') {
            openFn();
            highlightFn(0);
          } else {
            const next = Math.min(len - 1, Math.max(0, root._activeIndex + 1));
            highlightFn(next);
            DOMHelpers._scrollIntoViewIfNeeded(list, list.children[next]);
          }
        } else if (key === 'ArrowUp') {
          e.preventDefault();
          if (list.style.display === 'none') {
            openFn();
            highlightFn(len - 1);
          } else {
            const prev = Math.max(0, root._activeIndex - 1);
            highlightFn(prev);
            DOMHelpers._scrollIntoViewIfNeeded(list, list.children[prev]);
          }
        } else if (key === 'Enter' || key === ' ') {
          e.preventDefault();
          if (list.style.display === 'none') {
            openFn();
            highlightFn(root._activeIndex >= 0 ? root._activeIndex : 0);
          } else if (root._activeIndex >= 0) {
            selectFn(root._activeIndex);
          }
        } else if (key === 'Home') {
          e.preventDefault();
          highlightFn(0);
          DOMHelpers._scrollIntoViewIfNeeded(list, list.children[0]);
        } else if (key === 'End') {
          e.preventDefault();
          highlightFn(len - 1);
          DOMHelpers._scrollIntoViewIfNeeded(list, list.children[len - 1]);
        } else if (key === 'Escape') {
          if (list.style.display !== 'none') {
            e.preventDefault();
            closeFn();
          }
        }
      };
    },

    /**
     * Create an accessible, keyboard-navigable custom select control.
     * Returns an element with API: setOptions([{value,text}]), setPlaceholder(text), value (getter/setter), disabled (getter/setter)
     */
    createCustomSelect() {
      // use internal counter stored on root to avoid long local state
      const root = document.createElement('div');
      root.className = 'ytp-plus-custom-select';
      root.tabIndex = 0;
      root.setAttribute('role', 'combobox');
      root.setAttribute('aria-haspopup', 'listbox');
      root.setAttribute('aria-expanded', 'false');

      Object.assign(root.style, {
        position: 'relative',
        display: 'inline-block',
        width: 'auto',
      });

      const display = document.createElement('div');
      display.className = 'ytp-plus-custom-select-display';
      display.tabIndex = -1;
      Object.assign(display.style, {
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        color: 'inherit',
        minWidth: '70px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer',
      });

      const label = document.createElement('div');
      label.className = 'ytp-plus-custom-select-label';
      label.style.flex = '1';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';
      label.textContent = '';

      const chevron = document.createElement('div');
      chevron.textContent = '▾';
      chevron.style.opacity = '0.8';

      display.appendChild(label);
      display.appendChild(chevron);

      const list = document.createElement('div');
      list.setAttribute('role', 'listbox');
      list.className = 'ytp-plus-custom-select-list';
      Object.assign(list.style, {
        position: 'absolute',
        left: '0',
        right: '0',
        top: 'calc(100% + 6px)',
        maxHeight: '220px',
        overflowY: 'auto',
        display: 'none',
        borderRadius: '8px',
        background: 'linear-gradient(rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.02))',
        border: '1px solid rgba(255,255,255,0.06)',
        backdropFilter: 'blur(8px)',
        boxShadow: 'rgba(0, 0, 0, 0.6) 0px 8px 30px',
        zIndex: 9999,
      });

      root.appendChild(display);
      root.appendChild(list);

      root._options = [];
      root._value = '';
      root._disabled = false;
      root._activeIndex = -1;
      root._idCounter = 0;

      const closeList = () => {
        list.style.display = 'none';
        root.setAttribute('aria-expanded', 'false');
      };

      const openList = () => {
        if (root._disabled) return;
        list.style.display = '';
        root.setAttribute('aria-expanded', 'true');
      };

      const highlightIndex = idx => {
        const items = Array.from(list.children);
        items.forEach((it, i) => {
          if (i === idx) {
            it.classList.add('active');
            it.style.background = 'rgba(255,255,255,0.03)';
            it.setAttribute('aria-selected', 'true');
            root._activeIndex = i;
            root.setAttribute('aria-activedescendant', it.id || '');
          } else {
            it.classList.remove('active');
            it.style.background = 'transparent';
            it.setAttribute('aria-selected', 'false');
          }
        });
      };

      const selectIndex = idx => {
        const opt = root._options[idx];
        if (!opt) return;
        root.value = opt.value;
        closeList();
        root.dispatchEvent(new Event('change', { bubbles: true }));
      };

      display.addEventListener('click', e => {
        if (root._disabled) return;
        e.stopPropagation();
        if (list.style.display === 'none') openList();
        else closeList();
      });

      // Close when clicking outside
      document.addEventListener('click', e => {
        if (!root.contains(e.target)) closeList();
      });

      // Keyboard navigation handled by shared helper to reduce function size
      root._selectIndexFn = selectIndex;
      root._highlightFn = highlightIndex;
      root.addEventListener(
        'keydown',
        DOMHelpers._makeCustomSelectKeyHandler(
          root,
          list,
          openList,
          closeList,
          highlightIndex,
          selectIndex
        )
      );

      root.setPlaceholder = text => {
        label.textContent = text || '';
        root._options = [];
        list.innerHTML = '';
        root._value = '';
        root._activeIndex = -1;
      };

      // Delegate option creation to shared helper
      root.setOptions = options => DOMHelpers._setCustomSelectOptions(root, list, options);

      Object.defineProperty(root, 'value', {
        get() {
          return root._value;
        },
        set(v) {
          root._value = String(v);
          const found = root._options.find(o => String(o.value) === String(root._value));
          label.textContent = found ? found.text : '';
        },
      });

      Object.defineProperty(root, 'disabled', {
        get() {
          return root._disabled;
        },
        set(v) {
          root._disabled = !!v;
          root.style.pointerEvents = root._disabled ? 'none' : '';
          root.style.opacity = root._disabled ? '0.5' : '1';
        },
      });

      return root;
    },

    /**
     * Safely query all elements with error handling
     * @param {Element} parent - Parent element to query from
     * @param {string} selector - CSS selector
     * @returns {Element[]} Array of found elements
     */
    safeQueryAll(parent, selector) {
      try {
        if (!parent || typeof parent.querySelectorAll !== 'function') return [];
        return Array.from(parent.querySelectorAll(selector));
      } catch (error) {
        console.warn('[YouTube+][DOMHelpers] QueryAll failed:', selector, error);
        return [];
      }
    },

    /**
     * Safely get attribute value with default fallback
     * @param {Element} element - Element to get attribute from
     * @param {string} attr - Attribute name
     * @param {*} defaultValue - Default value if attribute doesn't exist
     * @returns {*} Attribute value or default
     */
    safeGetAttribute(element, attr, defaultValue = null) {
      try {
        if (!element || typeof element.getAttribute !== 'function') return defaultValue;
        const value = element.getAttribute(attr);
        return value === null ? defaultValue : value;
      } catch {
        return defaultValue;
      }
    },

    /**
     * Safely set attribute with validation
     * @param {Element} element - Element to set attribute on
     * @param {string} attr - Attribute name
     * @param {*} value - Attribute value
     * @returns {boolean} Success status
     */
    safeSetAttribute(element, attr, value) {
      try {
        if (!element || typeof element.setAttribute !== 'function') return false;
        if (!attr || typeof attr !== 'string') return false;
        element.setAttribute(attr, String(value));
        return true;
      } catch (error) {
        console.warn('[YouTube+][DOMHelpers] setAttribute failed:', attr, error);
        return false;
      }
    },

    /**
     * Check if element matches selector
     * @param {Element} element - Element to check
     * @param {string} selector - CSS selector
     * @returns {boolean} True if matches
     */
    matches(element, selector) {
      try {
        if (!element || typeof element.matches !== 'function') return false;
        return element.matches(selector);
      } catch {
        return false;
      }
    },

    /**
     * Find closest ancestor matching selector
     * @param {Element} element - Starting element
     * @param {string} selector - CSS selector
     * @returns {Element|null} Matching ancestor or null
     */
    closest(element, selector) {
      try {
        if (!element || typeof element.closest !== 'function') return null;
        return element.closest(selector);
      } catch {
        return null;
      }
    },
  };

  /**
   * Nesting Helper to reduce nesting depth
   * @namespace NestingHelpers
   */
  const NestingHelpers = {
    /**
     * Early return pattern for validation
     * @param {boolean} condition - Condition to check
     * @param {Function} callback - Callback to execute if condition is true
     * @returns {boolean} True if callback was executed
     */
    earlyReturn(condition, callback) {
      if (!condition) return false;
      if (typeof callback === 'function') callback();
      return true;
    },

    /**
     * Guard clause pattern
     * @param {Array<{condition: boolean, message?: string}>} guards - Array of guard conditions
     * @returns {boolean} True if all guards pass
     */
    guardClauses(guards) {
      for (const guard of guards) {
        if (!guard.condition) {
          if (guard.message) {
            console.warn('[YouTube+] Guard clause failed:', guard.message);
          }
          return false;
        }
      }
      return true;
    },

    /**
     * Extract nested logic into separate function
     * @param {Function} fn - Function to execute
     * @param {*} context - Context (this) for function
     * @param {...*} args - Arguments to pass to function
     * @returns {*} Function result
     */
    extractLogic(fn, context = null, ...args) {
      if (typeof fn !== 'function') return null;
      try {
        return fn.apply(context, args);
      } catch (error) {
        console.error('[YouTube+][NestingHelpers] Logic extraction failed:', error);
        return null;
      }
    },

    /**
     * Process array items with reduced nesting
     * @template T
     * @param {T[]} items - Items to process
     * @param {Function} processFn - Processing function
     * @param {Object} options - Processing options
     * @returns {T[]} Processed items
     */
    processItems(items, processFn, options = {}) {
      const { continueOnError = true, filterFn = null, maxItems = Infinity } = options;

      if (!Array.isArray(items)) return [];
      if (typeof processFn !== 'function') return items;

      const results = [];
      let processedCount = 0;

      for (const item of items) {
        if (processedCount >= maxItems) break;

        // Apply filter if provided
        if (filterFn && !filterFn(item)) continue;

        try {
          const result = processFn(item);
          if (result !== undefined) {
            results.push(result);
            processedCount++;
          }
        } catch (error) {
          if (!continueOnError) throw error;
          console.warn('[YouTube+][NestingHelpers] Item processing failed:', error);
        }
      }

      return results;
    },
  };

  /**
   * Async operation helpers
   * @namespace AsyncHelpers
   */
  const AsyncHelpers = {
    /**
     * Retry async operation with exponential backoff
     * @param {Function} asyncFn - Async function to retry
     * @param {Object} options - Retry options
     * @returns {Promise<*>} Result or error
     */
    async retry(asyncFn, options = {}) {
      const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2,
        onRetry = null,
      } = options;

      let lastError;
      let delay = initialDelay;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await asyncFn();
        } catch (error) {
          lastError = error;

          if (attempt === maxRetries) break;

          if (typeof onRetry === 'function') {
            onRetry(attempt + 1, error, delay);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
      }

      throw lastError;
    },

    /**
     * Timeout wrapper for async operations
     * @param {Promise} promise - Promise to wrap
     * @param {number} timeoutMs - Timeout in milliseconds
     * @param {string} errorMessage - Error message for timeout
     * @returns {Promise<*>} Result or timeout error
     */
    async withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      });

      try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    },

    /**
     * Debounced async function
     * @param {Function} asyncFn - Async function to debounce
     * @param {number} delay - Debounce delay in ms
     * @returns {Function} Debounced function
     */
    debounceAsync(asyncFn, delay) {
      let timeoutId = null;
      let latestPromise = null;

      return async function (...args) {
        if (timeoutId) clearTimeout(timeoutId);

        latestPromise = new Promise((resolve, reject) => {
          timeoutId = setTimeout(async () => {
            try {
              const result = await asyncFn.apply(this, args);
              resolve(result);
            } catch (error) {
              reject(error);
            }
          }, delay);
        });

        return latestPromise;
      };
    },
  };

  /**
   * Condition Helper to improve readability
   * @namespace ConditionHelpers
   */
  const ConditionHelpers = {
    /**
     * Check if all conditions are met
     * @param {...boolean} conditions - Conditions to check
     * @returns {boolean} True if all conditions are true
     */
    all(...conditions) {
      return conditions.every(c => c);
    },

    /**
     * Check if any condition is met
     * @param {...boolean} conditions - Conditions to check
     * @returns {boolean} True if any condition is true
     */
    any(...conditions) {
      return conditions.some(c => c);
    },

    /**
     * Check if none of the conditions are met
     * @param {...boolean} conditions - Conditions to check
     * @returns {boolean} True if no conditions are true
     */
    none(...conditions) {
      return conditions.every(c => !c);
    },

    /**
     * Invert negated condition for better readability
     * @param {boolean} condition - Condition to check
     * @param {Function} thenFn - Function to call if condition is true
     * @param {Function} elseFn - Function to call if condition is false
     * @returns {*} Result from executed function
     */
    ifThenElse(condition, thenFn, elseFn = null) {
      if (condition) {
        return typeof thenFn === 'function' ? thenFn() : undefined;
      }
      return typeof elseFn === 'function' ? elseFn() : undefined;
    },
  };

  /**
   * State Management Helper
   * @namespace StateHelpers
   */
  const StateHelpers = {
    /**
     * Create a simple state manager
     * @param {Object} initialState - Initial state object
     * @returns {Object} State manager with get, set, update methods
     */
    createState(initialState = {}) {
      let state = { ...initialState };
      const listeners = new Set();

      return {
        get(key) {
          return key ? state[key] : { ...state };
        },

        set(key, value) {
          const oldValue = state[key];
          state[key] = value;
          this.notify(key, value, oldValue);
        },

        update(partial) {
          const oldState = { ...state };
          state = { ...state, ...partial };
          this.notify('*', state, oldState);
        },

        subscribe(listener) {
          if (typeof listener === 'function') {
            listeners.add(listener);
          }
          return () => listeners.delete(listener);
        },

        notify(key, newValue, oldValue) {
          for (const listener of listeners) {
            try {
              listener(key, newValue, oldValue);
            } catch (error) {
              console.error('[YouTube+][StateHelpers] Listener error:', error);
            }
          }
        },

        reset() {
          state = { ...initialState };
          this.notify('*', state, {});
        },
      };
    },
  };

  /**
   * Export helpers to global scope
   */
  if (typeof window !== 'undefined') {
    window.YouTubePlusHelpers = {
      DOM: DOMHelpers,
      Nesting: NestingHelpers,
      Async: AsyncHelpers,
      Condition: ConditionHelpers,
      State: StateHelpers,
    };

    console.log('[YouTube+] Helper utilities loaded');
  }
})();
