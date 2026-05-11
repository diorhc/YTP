// Event Delegation System - Performance Optimization
(function () {
  'use strict';

  /**
   * Event delegation manager for performance optimization
   * Reduces number of event listeners by delegating to common ancestors
   */
  class EventDelegator {
    constructor() {
      /** @type {Map<string, Map<string, Set<Function>>>} */
      this.delegatedHandlers = new Map();
      /** @type {Map<Element, Map<string, Function>>} */
      this.registeredDelegators = new Map();
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
    }

    /**
     * Delegate event handler to a parent element
     * @param {Element} parent - Parent element to attach delegated listener
     * @param {string} eventType - Event type (click, input, etc.)
     * @param {string} selector - CSS selector to match target elements
     * @param {Function} handler - Handler function(event, matchedElement)
     * @param {Object} [options] - Event listener options
     */
    delegate(parent, eventType, selector, handler, options = {}) {
      if (!parent || !eventType || !selector || !handler) {
        console.warn('[EventDelegator] Invalid parameters');
        return;
      }

      // Create cache key
      const parentKey = this._getElementKey(parent);
      const delegationKey = `${parentKey}:${eventType}`;

      // Initialize structures
      if (!this.delegatedHandlers.has(delegationKey)) {
        this.delegatedHandlers.set(delegationKey, new Map());
      }

      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return;
      if (!handlersForSelector.has(selector)) {
        handlersForSelector.set(selector, new Set());
      }

      // Add handler
      handlersForSelector.get(selector)?.add(handler);
      this.stats.totalHandlers++;

      // Create or get delegated listener
      if (!this.registeredDelegators.has(parent)) {
        this.registeredDelegators.set(parent, new Map());
      }

      const parentDelegators = this.registeredDelegators.get(parent);
      if (!parentDelegators) return;
      if (!parentDelegators.has(eventType)) {
        /** @param {Event} event */
        const delegatedListener = event => {
          this._handleDelegatedEvent(parent, eventType, event);
        };

        parent.addEventListener(
          eventType,
          /** @type {EventListener} */ (delegatedListener),
          /** @type {boolean|AddEventListenerOptions} */ (options)
        );
        parentDelegators.set(eventType, delegatedListener);
        this.stats.totalDelegations++;

        window.YouTubeUtils?.logger?.debug?.(
          `[EventDelegator] Created delegation on ${parentKey} for ${eventType}`
        );
      }
    }

    /**
     * Remove delegated event handler
     * @param {Element} parent - Parent element
     * @param {string} eventType - Event type
     * @param {string} selector - CSS selector
     * @param {Function} handler - Handler function to remove
     */
    undelegate(parent, eventType, selector, handler) {
      const parentKey = this._getElementKey(parent);
      const delegationKey = `${parentKey}:${eventType}`;

      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return;

      const handlers = handlersForSelector.get(selector);
      if (!handlers) return;

      handlers.delete(handler);
      this.stats.totalHandlers--;

      // Clean up if no handlers left
      if (handlers.size === 0) {
        handlersForSelector.delete(selector);
      }

      if (handlersForSelector.size === 0) {
        this._removeParentListener(parent, eventType);
        this.delegatedHandlers.delete(delegationKey);
      }
    }

    /**
     * Handle delegated event and dispatch to matching handlers
     * @private
     */
    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {Event} event
     */
    _handleDelegatedEvent(parent, eventType, event) {
      const parentKey = this._getElementKey(parent);
      const delegationKey = `${parentKey}:${eventType}`;
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);

      if (!handlersForSelector) return;

      // Check each selector for matches
      for (const [selector, handlers] of handlersForSelector.entries()) {
        // Find closest matching element
        const evtTarget = /** @type {HTMLElement|null} */ (event.target);
        const target = evtTarget?.closest(selector);

        if (target && parent.contains(target)) {
          // Execute all handlers for this selector
          for (const handler of handlers) {
            try {
              handler.call(target, event, target);
            } catch (error) {
              console.error('[EventDelegator] Handler error:', error);
              window.YouTubeUtils?.logger?.error?.('[EventDelegator] Handler error', error);
            }
          }
        }
      }
    }

    /**
     * Remove parent listener
     * @private
     */
    /**
     * @param {Element} parent
     * @param {string} eventType
     */
    _removeParentListener(parent, eventType) {
      const parentDelegators = this.registeredDelegators.get(parent);
      if (!parentDelegators) return;

      const listener = parentDelegators.get(eventType);
      if (listener) {
        parent.removeEventListener(eventType, /** @type {EventListener} */ (listener));
        parentDelegators.delete(eventType);
        this.stats.totalDelegations--;
      }

      if (parentDelegators.size === 0) {
        this.registeredDelegators.delete(parent);
      }
    }

    /**
     * Get unique key for element
     * @private
     */
    /**
     * @param {Element|Document} element
     * @returns {string}
     */
    _getElementKey(element) {
      if (element === document) return 'document';
      if (element === /** @type {any} */ (window)) return 'window';
      if (element === document.body) return 'body';

      // Use a WeakMap for stable, deterministic element keys
      if (!this._elementKeyMap) {
        this._elementKeyMap = new WeakMap();
        this._elementKeyCounter = 0;
      }
      const htmlEl = /** @type {Element} */ (element);
      if (htmlEl.id) return htmlEl.id;
      const existing = this._elementKeyMap.get(htmlEl);
      if (existing) return existing;
      const newKey = `${htmlEl.tagName || 'ELEM'}_${(this._elementKeyCounter = (this._elementKeyCounter || 0) + 1)}`;
      this._elementKeyMap.set(htmlEl, newKey);
      return newKey;
    }

    /**
     * Get statistics
     */
    getStats() {
      return {
        ...this.stats,
        uniqueDelegations: this.registeredDelegators.size,
        delegationKeys: this.delegatedHandlers.size,
      };
    }

    /**
     * Clear all delegations
     */
    clear() {
      for (const [parent, delegators] of this.registeredDelegators.entries()) {
        for (const eventType of delegators.keys()) {
          try {
            parent.removeEventListener(
              eventType,
              /** @type {EventListener} */ (delegators.get(eventType))
            );
          } catch (e) {
            // Element may have been GC'd — safe to ignore
          }
        }
      }

      this.delegatedHandlers.clear();
      this.registeredDelegators.clear();
      if (this._elementKeyMap) {
        this._elementKeyMap = new WeakMap();
        this._elementKeyCounter = 0;
      }
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
    }
  }

  // Create global instance
  const eventDelegator = new EventDelegator();

  /**
   * Convenience wrapper for delegation
   * @param {Element} parent - Parent element
   * @param {string} eventType - Event type
   * @param {string} selector - CSS selector
   * @param {Function} handler - Handler function
   * @param {Object} [options] - Event listener options
   */
  const on = (parent, eventType, selector, handler, options) => {
    eventDelegator.delegate(parent, eventType, selector, handler, options);
  };

  /**
   * Remove delegated handler
   * @param {Element} parent - Parent element
   * @param {string} eventType - Event type
   * @param {string} selector - CSS selector
   * @param {Function} handler - Handler function
   */
  const off = (parent, eventType, selector, handler) => {
    eventDelegator.undelegate(parent, eventType, selector, handler);
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusEventDelegation =
      /** @type {YouTubePlusEventDelegation & {EventDelegator: any, on: Function, off: Function, clear: Function}} */ ({
        EventDelegator,
        on,
        off,
        delegate: (parent, eventType, selector, handler, options) =>
          eventDelegator.delegate(
            /** @type {Element} */ (parent),
            eventType,
            selector,
            handler,
            options
          ),
        undelegate: (parent, eventType, selector, handler) =>
          eventDelegator.undelegate(/** @type {Element} */ (parent), eventType, selector, handler),
        getStats: () => eventDelegator.getStats(),
        clear: () => eventDelegator.clear(),
      });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventDelegator, on, off };
  }
})();
