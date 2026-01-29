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
      /** @type {Map<Element, Map<string, Function>}>} */
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
      if (!handlersForSelector.has(selector)) {
        handlersForSelector.set(selector, new Set());
      }

      // Add handler
      handlersForSelector.get(selector).add(handler);
      this.stats.totalHandlers++;

      // Create or get delegated listener
      if (!this.registeredDelegators.has(parent)) {
        this.registeredDelegators.set(parent, new Map());
      }

      const parentDelegators = this.registeredDelegators.get(parent);
      if (!parentDelegators.has(eventType)) {
        const delegatedListener = event => {
          this._handleDelegatedEvent(parent, eventType, event);
        };

        parent.addEventListener(eventType, delegatedListener, options);
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
    _handleDelegatedEvent(parent, eventType, event) {
      const parentKey = this._getElementKey(parent);
      const delegationKey = `${parentKey}:${eventType}`;
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);

      if (!handlersForSelector) return;

      // Check each selector for matches
      for (const [selector, handlers] of handlersForSelector.entries()) {
        // Find closest matching element
        const target = event.target.closest(selector);

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
    _removeParentListener(parent, eventType) {
      const parentDelegators = this.registeredDelegators.get(parent);
      if (!parentDelegators) return;

      const listener = parentDelegators.get(eventType);
      if (listener) {
        parent.removeEventListener(eventType, listener);
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
    _getElementKey(element) {
      if (element === document) return 'document';
      if (element === window) return 'window';
      if (element === document.body) return 'body';

      return (
        element.id ||
        element.className ||
        element.tagName ||
        `elem_${Math.random().toString(36).substr(2, 9)}`
      );
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
        for (const [eventType, listener] of delegators.entries()) {
          parent.removeEventListener(eventType, listener);
        }
      }

      this.delegatedHandlers.clear();
      this.registeredDelegators.clear();
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
    window.YouTubePlusEventDelegation = {
      EventDelegator,
      on,
      off,
      getStats: () => eventDelegator.getStats(),
      clear: () => eventDelegator.clear(),
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { EventDelegator, on, off };
  }
})();
