// Event Delegation - canonical delegated event service.
//
// Canonical responsibility:
//   - own delegated handler registration (on / delegate)
//   - own delegated handler removal (off / undelegate)
//   - own selector matching and bookkeeping for registered delegations
//
// Public API on `window.YouTubePlusEventDelegation`:
//   - on(root, type, selector, handler, options?)
//   - off(root, type, selector, handler)
//   - delegate(...) / undelegate(...)  // legacy aliases, kept for compatibility
//   - clear()                          // teardown helper
//   - getStats()                       // diagnostics
//
// This module is intentionally narrow. It does not own
// listener/observer/interval cleanup (see cleanup-manager.js)
// and does not own mutation lifecycle (see mutation-coordinator.js).
//
// @ts-check
(function () {
  if (typeof window === 'undefined') return;
  if (window.YouTubePlusEventDelegation) return;

  const edLogger = window.YouTubeUtils?.logger || null;

  // ---------------------------------------------------------------------------
  // Internal implementation
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Element | Document | Window} DelegationRoot
   */

  /**
   * @typedef {{
   *   totalDelegations: number,
   *   totalHandlers: number
   * }} DelegationStats
   */

  class EventDelegator {
    constructor() {
      /** @type {Map<string, Map<string, Set<Function>>>} */
      this.delegatedHandlers = new Map();
      /** @type {Map<Element, Map<string, Function>>} */
      this.registeredDelegators = new Map();
      /** @type {WeakMap<Element, string>} */
      this._elementKeyMap = new WeakMap();
      /** @type {number} */
      this._elementKeyCounter = 0;
      /** @type {DelegationStats} */
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
    }

    /**
     * Register a delegated handler on `root` for events matching `selector`.
     * Multiple handlers for the same (root, type, selector) are supported and
     * all are invoked in insertion order.
     * @param {DelegationRoot} root
     * @param {string} eventType
     * @param {string} selector
     * @param {Function} handler
     * @param {boolean | AddEventListenerOptions} [options]
     */
    on(root, eventType, selector, handler, options) {
      if (!(root && eventType && selector && handler)) {
        edLogger?.warn?.('EventDelegator', 'Invalid parameters');
        return;
      }
      const parent = /** @type {Element} */ (root);

      const delegationKey = `${this._getElementKey(parent)}:${eventType}`;

      let handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) {
        handlersForSelector = new Map();
        this.delegatedHandlers.set(delegationKey, handlersForSelector);
      }
      let handlers = handlersForSelector.get(selector);
      if (!handlers) {
        handlers = new Set();
        handlersForSelector.set(selector, handlers);
      }
      handlers.add(handler);
      this.stats.totalHandlers++;

      this._ensureRootListener(parent, eventType, options);
    }

    /**
     * Remove a delegated handler previously registered with `on`.
     * Silently no-ops if the handler is not registered.
     * @param {DelegationRoot} root
     * @param {string} eventType
     * @param {string} selector
     * @param {Function} handler
     */
    off(root, eventType, selector, handler) {
      if (!(root && eventType && selector && handler)) return;
      const parent = /** @type {Element} */ (root);

      const delegationKey = `${this._getElementKey(parent)}:${eventType}`;
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return;

      const handlers = handlersForSelector.get(selector);
      if (!handlers?.delete(handler)) return;
      this.stats.totalHandlers--;

      if (handlers.size === 0) {
        handlersForSelector.delete(selector);
      }
      if (handlersForSelector.size === 0) {
        this._removeRootListener(parent, eventType);
        this.delegatedHandlers.delete(delegationKey);
      }
    }

    /**
     * @returns {DelegationStats & { uniqueDelegations: number, delegationKeys: number }}
     */
    getStats() {
      return {
        ...this.stats,
        uniqueDelegations: this.registeredDelegators.size,
        delegationKeys: this.delegatedHandlers.size,
      };
    }

    /** Tear down all delegations. Safe to call multiple times. */
    clear() {
      for (const [parent, byType] of this.registeredDelegators.entries()) {
        for (const eventType of byType.keys()) {
          try {
            const listener = byType.get(eventType);
            if (listener) {
              parent.removeEventListener(eventType, /** @type {EventListener} */ (listener));
            }
          } catch (_e) {
            // Element may have been GC'd or detached; safe to ignore.
          }
        }
      }
      this.delegatedHandlers.clear();
      this.registeredDelegators.clear();
      this._elementKeyMap = new WeakMap();
      this._elementKeyCounter = 0;
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
    }

    // -- internal ------------------------------------------------------------

    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {boolean | AddEventListenerOptions | undefined} options
     */
    _ensureRootListener(parent, eventType, options) {
      let byType = this.registeredDelegators.get(parent);
      if (!byType) {
        byType = new Map();
        this.registeredDelegators.set(parent, byType);
      }
      if (byType.has(eventType)) return;

      const listener = /** @param {Event} event */ event => {
        this._dispatch(parent, eventType, event);
      };
      parent.addEventListener(
        eventType,
        /** @type {EventListener} */ (listener),
        /** @type {boolean | AddEventListenerOptions | undefined} */ (options)
      );
      byType.set(eventType, listener);
      this.stats.totalDelegations++;
      edLogger?.debug?.(
        `[EventDelegator] Created delegation on ${this._getElementKey(parent)} for ${eventType}`
      );
    }

    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {Event} event
     */
    _dispatch(parent, eventType, event) {
      const delegationKey = `${this._getElementKey(parent)}:${eventType}`;
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return;

      const evtTarget = /** @type {HTMLElement | null} */ (event.target);
      for (const [selector, handlers] of handlersForSelector.entries()) {
        const target = evtTarget?.closest(selector);
        if (!(target && parent.contains(target))) continue;
        for (const handler of handlers) {
          try {
            handler.call(target, event, target);
          } catch (error) {
            edLogger?.error?.('EventDelegator', 'Handler error', error);
          }
        }
      }
    }

    /**
     * @param {Element} parent
     * @param {string} eventType
     */
    _removeRootListener(parent, eventType) {
      const byType = this.registeredDelegators.get(parent);
      if (!byType) return;
      const listener = byType.get(eventType);
      if (listener) {
        parent.removeEventListener(eventType, /** @type {EventListener} */ (listener));
        this.stats.totalDelegations--;
      }
      byType.delete(eventType);
      if (byType.size === 0) {
        this.registeredDelegators.delete(parent);
      }
    }

    /**
     * Stable per-element key used for map indexing.
     * @param {Element | Document | Window} element
     * @returns {string}
     */
    _getElementKey(element) {
      if (element === document) return 'document';
      if (element === /** @type {any} */ (window)) return 'window';
      if (element === document.body) return 'body';
      const el = /** @type {Element} */ (element);
      if (el.id) return el.id;
      const existing = this._elementKeyMap.get(el);
      if (existing) return existing;
      this._elementKeyCounter += 1;
      const key = `${el.tagName || 'ELEM'}_${this._elementKeyCounter}`;
      this._elementKeyMap.set(el, key);
      return key;
    }
  }

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  const delegator = new EventDelegator();

  const surface =
    /** @type {YouTubePlusEventDelegation & { EventDelegator: any, clear: Function }} */ ({
      EventDelegator,
      on: (root, eventType, selector, handler, options) =>
        delegator.on(/** @type {Element} */ (root), eventType, selector, handler, options),
      off: (root, eventType, selector, handler) =>
        delegator.off(/** @type {Element} */ (root), eventType, selector, handler),
      delegate: (root, eventType, selector, handler, options) =>
        delegator.on(/** @type {Element} */ (root), eventType, selector, handler, options),
      undelegate: (root, eventType, selector, handler) =>
        delegator.off(/** @type {Element} */ (root), eventType, selector, handler),
      getStats: () => delegator.getStats(),
      clear: () => delegator.clear(),
    });

  window.YouTubePlusEventDelegation = surface;
  if (typeof unsafeWindow !== 'undefined') {
    unsafeWindow.YouTubePlusEventDelegation = surface;
  }
})();
