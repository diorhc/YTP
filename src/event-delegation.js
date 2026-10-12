// Event Delegation: delegated event service.
//
// Responsibility:
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
//   - attachHoverPopover(anchor, panel, opts?)  // hover popover wiring
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

  const getPhase = (/** @type {boolean | AddEventListenerOptions | undefined} */ options) =>
    (options && typeof options === 'object' ? Boolean(options.capture) : Boolean(options))
      ? 'capture'
      : 'bubble';

  class EventDelegator {
    constructor() {
      /** @type {Map<string, Map<string, Set<Function>>>} */
      this.delegatedHandlers = new Map();
      /** @type {Map<Element, Map<string, Function>>} */
      this.registeredDelegators = new Map();
      /** @type {Map<Element, Map<string, boolean | AddEventListenerOptions | undefined>>} */
      this._rootListenerOptions = new Map();
      /** @type {WeakMap<Element, string>} */
      this._elementKeyMap = new WeakMap();
      /** @type {number} */
      this._elementKeyCounter = 0;
      /** @type {DelegationStats} */
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
      // Per-handler option metadata (once / signal) for shared root
      // delegations. The native root listener is registered WITHOUT once /
      // signal / passive inheritance; the first registrant's options must
      // never tear down or constrain the whole delegation.
      /** @type {Map<string, Map<string, Map<Function, {once: boolean, signal: AbortSignal | null, abortListener: (() => void) | null}>>>} */
      this._handlerMeta = new Map();
      // Per-registration generation. Every on() stamps the live
      // registration with a fresh id; off() (and every path routed through
      // _offSingle) deletes it. The dispatcher snapshots the generation at
      // snapshot time and re-checks it right before each invoke, giving the
      // delegated list native removed-flag semantics even when handlers
      // mutate registrations during the same dispatch.
      /** @type {Map<string, Map<string, Map<Function, number>>>} */
      this._handlerGeneration = new Map();
      /** @type {number} */
      this._generationCounter = 0;
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
     * @returns {() => void} Idempotent disposer function
     */
    on(root, eventType, selector, handler, options) {
      if (!(root && eventType && selector && handler)) {
        edLogger?.warn?.('EventDelegator', 'Invalid parameters');
        return () => {};
      }
      const parent = /** @type {Element} */ (root);
      const phase = getPhase(options);
      const delegationKey = this._delegationKey(parent, eventType, phase);

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

      const disposer = () => {
        this.off(parent, eventType, selector, handler, options);
      };

      if (handlers.has(handler)) {
        return disposer;
      }

      const opts = options && typeof options === 'object' ? options : null;
      // an already-aborted signal mirrors native addEventListener;
      // the listener is never called, so fail closed without registering.
      if (opts?.signal?.aborted) {
        return () => {};
      }

      handlers.add(handler);
      this.stats.totalHandlers++;
      this._recordHandlerGeneration(delegationKey, selector, handler);
      this._recordHandlerMeta(parent, eventType, phase, selector, handler, opts);

      this._ensureRootListener(parent, eventType, phase);
      return disposer;
    }

    /**
     * Remove a delegated handler registered with `on`.
     * Silently no-ops if the handler is not registered.
     * @param {DelegationRoot} root
     * @param {string} eventType
     * @param {string} selector
     * @param {Function} handler
     * @param {boolean | AddEventListenerOptions} [options]
     */
    off(root, eventType, selector, handler, options) {
      if (!(root && eventType && selector && handler)) return;
      const parent = /** @type {Element} */ (root);

      if (options !== undefined) {
        const phase = getPhase(options);
        this._offSingle(parent, eventType, selector, handler, phase);
      } else {
        const removed = this._offSingle(parent, eventType, selector, handler, 'bubble');
        if (!removed) {
          this._offSingle(parent, eventType, selector, handler, 'capture');
        }
      }
    }

    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {string} selector
     * @param {Function} handler
     * @param {'bubble' | 'capture'} phase
     * @returns {boolean}
     */
    _offSingle(parent, eventType, selector, handler, phase) {
      const delegationKey = this._delegationKey(parent, eventType, phase);
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return false;

      const handlers = handlersForSelector.get(selector);
      if (!handlers?.delete(handler)) return false;
      this.stats.totalHandlers--;
      // Prune the EMPTIED generation buckets at every level, so
      // independent on/off cycles do not accumulate metadata maps (the audit
      // probe: 1000 different roots left 1000 generation buckets at 0
      // handlers). Empty selector/root levels must be released like the
      // meta buckets are.
      const genBySelector = this._handlerGeneration.get(delegationKey);
      const genByHandler = genBySelector?.get(selector);
      if (genByHandler && genBySelector) {
        genByHandler.delete(handler);
        if (genByHandler.size === 0) genBySelector.delete(selector);
      }
      if (genBySelector && genBySelector.size === 0) {
        this._handlerGeneration.delete(delegationKey);
      }
      this._releaseHandlerMeta(delegationKey, selector, handler);

      if (handlers.size === 0) {
        handlersForSelector.delete(selector);
      }
      if (handlersForSelector.size === 0) {
        this._removeRootListener(parent, eventType, phase);
        this.delegatedHandlers.delete(delegationKey);
      }
      return true;
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
      for (const byType of this.registeredDelegators.entries()) {
        const parent = byType[0];
        const optsByType = this._rootListenerOptions.get(parent);
        for (const [typeKey, listener] of byType[1].entries()) {
          try {
            const eventType = typeKey.split(':')[0];
            const opts = optsByType?.get(typeKey);
            parent.removeEventListener(eventType, /** @type {EventListener} */ (listener), opts);
          } catch (_e) {
            // Element may have been GC'd or detached; safe to ignore.
          }
        }
      }
      // release pending per-handler signal subscriptions.
      for (const bySelector of this._handlerMeta.values()) {
        for (const byHandler of bySelector.values()) {
          for (const meta of byHandler.values()) {
            this._detachAbortListener(meta);
          }
        }
      }
      this.delegatedHandlers.clear();
      this.registeredDelegators.clear();
      this._rootListenerOptions.clear();
      this._handlerMeta.clear();
      this._handlerGeneration.clear();
      this._elementKeyMap = new WeakMap();
      this._elementKeyCounter = 0;
      this.stats = { totalDelegations: 0, totalHandlers: 0 };
    }

    // -- internal ------------------------------------------------------------

    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {'bubble' | 'capture'} phase
     */
    _ensureRootListener(parent, eventType, phase) {
      let byType = this.registeredDelegators.get(parent);
      if (!byType) {
        byType = new Map();
        this.registeredDelegators.set(parent, byType);
      }
      const typeKey = `${eventType}:${phase}`;
      if (byType.has(typeKey)) return;

      const listener = /** @param {Event} event */ event => {
        this._dispatch(parent, eventType, phase, event);
      };
      // The shared root listener is registered with the phase
      // capture flag ONLY. once/signal are enforced per-handler by the
      // dispatcher; passive cannot be honored per-handler on a shared
      // listener, so it is deliberately not inherited from the first
      // registrant.
      const rootOpts = { capture: phase === 'capture' };
      parent.addEventListener(eventType, /** @type {EventListener} */ (listener), rootOpts);
      byType.set(typeKey, listener);

      let optsByType = this._rootListenerOptions.get(parent);
      if (!optsByType) {
        optsByType = new Map();
        this._rootListenerOptions.set(parent, optsByType);
      }
      optsByType.set(typeKey, rootOpts);
      this.stats.totalDelegations++;
      edLogger?.debug?.(
        `[EventDelegator] Created delegation on ${this._getElementKey(parent)} for ${eventType} (${phase})`
      );
    }

    /**
     * @param {Element} parent
     * @param {string} eventType
     * @param {'bubble' | 'capture'} phase
     * @param {Event} event
     */
    _dispatch(parent, eventType, phase, event) {
      const delegationKey = this._delegationKey(parent, eventType, phase);
      const handlersForSelector = this.delegatedHandlers.get(delegationKey);
      if (!handlersForSelector) return;

      const evtTarget = /** @type {HTMLElement | null} */ (event.target);
      for (const [selector, handlers] of handlersForSelector.entries()) {
        // A synthetic event dispatched on the root itself carries the root as
        // `target` (document has no .closest), so no delegated match applies.
        const target = /** @type {Element | null} */ (evtTarget?.closest?.(selector) ?? null);
        if (!(target && parent.contains(target))) continue;
        // Capture the generation of each registration AT SNAPSHOT
        // time, before any handler runs and can mutate the registrations.
        // The COPY is essential: off()/re-add mutate the live map, and the
        // snapshot must keep the original generations to compare against.
        const generationsAtSnapshot = new Map(
          this._handlerGeneration.get(delegationKey)?.get(selector)
        );
        for (const handler of [...handlers]) {
          // Native removed-flag semantics. A registration removed during this
          // dispatch (by an earlier handler, an abort signal, or clear()) must
          // not run for the current event, and an off + re-add of the same
          // callback must not revive the stale snapshot entry; the re-added
          // registration has a new generation.
          if (
            generationsAtSnapshot?.get(handler) !==
            this._handlerGeneration.get(delegationKey)?.get(selector)?.get(handler)
          ) {
            continue;
          }
          const meta = this._handlerMeta.get(delegationKey)?.get(selector)?.get(handler);
          // Native once semantics: the listener is removed before it runs, so
          // a reentrant dispatch during the handler cannot invoke it twice, and
          // only this phase's registration is dropped.
          if (meta?.once) {
            this.off(parent, eventType, selector, handler, {
              capture: phase === 'capture',
            });
          }
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
     * @param {'bubble' | 'capture'} phase
     */
    _removeRootListener(parent, eventType, phase) {
      const byType = this.registeredDelegators.get(parent);
      if (!byType) return;
      const typeKey = `${eventType}:${phase}`;
      const listener = byType.get(typeKey);
      if (listener) {
        const opts = this._rootListenerOptions.get(parent)?.get(typeKey);
        parent.removeEventListener(eventType, /** @type {EventListener} */ (listener), opts);
        this.stats.totalDelegations--;
      }
      byType.delete(typeKey);
      this._rootListenerOptions.get(parent)?.delete(typeKey);
      if (byType.size === 0) {
        this.registeredDelegators.delete(parent);
        this._rootListenerOptions.delete(parent);
      }
    }

    /**
     * Build the internal delegation key for a (root, eventType, phase) tuple.
     * @param {DelegationRoot} root
     * @param {string} eventType
     * @param {'bubble' | 'capture'} [phase='bubble']
     * @returns {string}
     */
    _delegationKey(root, eventType, phase = 'bubble') {
      return `${this._getElementKey(root)}:${eventType}:${phase}`;
    }

    /**
     * Stamp a registration with a fresh generation id. Called from
     * on() for every NEW live registration; off()/clear() drop the entry.
     * @param {string} delegationKey
     * @param {string} selector
     * @param {Function} handler
     * @returns {void}
     */
    _recordHandlerGeneration(delegationKey, selector, handler) {
      let bySelector = this._handlerGeneration.get(delegationKey);
      if (!bySelector) {
        bySelector = new Map();
        this._handlerGeneration.set(delegationKey, bySelector);
      }
      let byHandler = bySelector.get(selector);
      if (!byHandler) {
        byHandler = new Map();
        bySelector.set(selector, byHandler);
      }
      byHandler.set(handler, ++this._generationCounter);
    }

    /**
     * Record per-handler option metadata (once / signal) for a registration.
     * @param {Element} parent
     * @param {string} eventType
     * @param {'bubble' | 'capture'} phase
     * @param {string} selector
     * @param {Function} handler
     * @param {AddEventListenerOptions | null} opts
     */
    _recordHandlerMeta(parent, eventType, phase, selector, handler, opts) {
      const once = Boolean(opts?.once);
      const signal = opts?.signal instanceof AbortSignal ? opts.signal : null;
      if (!(once || signal)) return;

      const delegationKey = this._delegationKey(parent, eventType, phase);
      let bySelector = this._handlerMeta.get(delegationKey);
      if (!bySelector) {
        bySelector = new Map();
        this._handlerMeta.set(delegationKey, bySelector);
      }
      let byHandler = bySelector.get(selector);
      if (!byHandler) {
        byHandler = new Map();
        bySelector.set(selector, byHandler);
      }
      const abortListener = signal
        ? () => {
            // Remove the registration in its own phase; a phase-less off()
            // would tear down the other phase of the same callback.
            this.off(parent, eventType, selector, handler, {
              capture: phase === 'capture',
            });
          }
        : null;
      if (signal && abortListener) {
        try {
          signal.addEventListener('abort', abortListener, { once: true });
        } catch (_e) {
          // Signal setup failed; the handler still works, only the abort
          // auto-removal is unavailable; degrade silently.
        }
      }
      byHandler.set(handler, { once, signal, abortListener });
    }

    /**
     * Drop the per-handler metadata and its pending signal subscription.
     * @param {string} delegationKey
     * @param {string} selector
     * @param {Function} handler
     */
    _releaseHandlerMeta(delegationKey, selector, handler) {
      const bySelector = this._handlerMeta.get(delegationKey);
      if (!bySelector) return;
      const byHandler = bySelector.get(selector);
      if (!byHandler) return;
      const meta = byHandler.get(handler);
      if (meta) {
        this._detachAbortListener(meta);
        byHandler.delete(handler);
      }
      if (byHandler.size === 0) bySelector.delete(selector);
      if (bySelector.size === 0) this._handlerMeta.delete(delegationKey);
    }

    /**
     * @param {{signal: AbortSignal | null, abortListener: (() => void) | null}} meta
     */
    _detachAbortListener(meta) {
      if (meta.signal && meta.abortListener) {
        try {
          meta.signal.removeEventListener('abort', meta.abortListener);
        } catch (_e) {
          // Signal may be gone; safe to ignore.
        }
        meta.abortListener = null;
      }
    }

    /**
     * Stable per-element key used for map indexing. Weak identity: a REPLACED
     * document.body must get its own key; a literal 'body' key would merge
     * the pre-swap and current body into a single delegation.
     * @param {Element | Document | Window} element
     * @returns {string}
     */
    _getElementKey(element) {
      if (element === document) return 'document';
      if (element === window) return 'window';
      const el = /** @type {Element} */ (element);
      const existing = this._elementKeyMap.get(el);
      if (existing) return existing;
      this._elementKeyCounter += 1;
      const key = `${el.tagName || 'ELEM'}_${this._elementKeyCounter}`;
      this._elementKeyMap.set(el, key);
      return key;
    }
  }

  // ---------------------------------------------------------------------------
  // Hover popover helper (dedup: zoom popup, vision zoom popover,
  // loop dropdown/pill, speed dropdown all share this show/hide-with-delay
  // pattern).
  // ---------------------------------------------------------------------------

  /**
   * Attach the shared hover-show / delayed-hide popover behavior.
   * Mouseenter on any listed anchor (or the panel) cancels a pending hide and
   * calls `opts.show()`. Mouseleave schedules a delayed hide that is skipped
   * when the pointer is still over the panel or the primary anchor.
   * @param {HTMLElement} anchor primary toggle element
   * @param {HTMLElement} panel popover element that receives `.visible`
   * @param {{ show: Function, hide: Function, hideDelay?: number, extraAnchors?: HTMLElement[] }} opts
   * @returns {() => void} dispose function removing all listeners
   */
  const attachHoverPopover = (anchor, panel, opts) => {
    if (
      !(anchor && panel) ||
      typeof opts?.show !== 'function' ||
      typeof opts?.hide !== 'function'
    ) {
      edLogger?.warn?.('EventDelegator', 'attachHoverPopover: invalid parameters');
      return () => {};
    }

    const hideDelay = typeof opts.hideDelay === 'number' ? opts.hideDelay : 250;
    const anchors = [anchor, ...(opts.extraAnchors || [])];
    /** @type {ReturnType<typeof setTimeout> | null} */
    let hideTimer = null;

    const cancelPendingHide = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const show = () => {
      cancelPendingHide();
      opts.show();
    };
    const scheduleHide = () => {
      cancelPendingHide();
      hideTimer = setTimeout(() => {
        hideTimer = null;
        const stillHovered =
          panel.matches(':hover') || anchors.some(a => a.isConnected && a.matches(':hover'));
        if (!stillHovered) opts.hide();
      }, hideDelay);
    };

    for (const el of anchors) {
      el.addEventListener('mouseenter', show);
      el.addEventListener('mouseleave', scheduleHide);
    }
    panel.addEventListener('mouseenter', cancelPendingHide);
    panel.addEventListener('mouseleave', scheduleHide);

    return () => {
      cancelPendingHide();
      for (const el of anchors) {
        el.removeEventListener('mouseenter', show);
        el.removeEventListener('mouseleave', scheduleHide);
      }
      panel.removeEventListener('mouseenter', cancelPendingHide);
      panel.removeEventListener('mouseleave', scheduleHide);
    };
  };

  // ---------------------------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------------------------

  const delegator = new EventDelegator();

  const surface =
    /** @type {YouTubePlusEventDelegation & { EventDelegator: typeof EventDelegator, clear: () => void }} */ ({
      EventDelegator,
      on: (
        /** @type {DelegationRoot} */ root,
        /** @type {string} */ eventType,
        /** @type {string} */ selector,
        /** @type {Function} */ handler,
        /** @type {boolean | AddEventListenerOptions} */ options
      ) => delegator.on(root, eventType, selector, handler, options),
      off: (
        /** @type {DelegationRoot} */ root,
        /** @type {string} */ eventType,
        /** @type {string} */ selector,
        /** @type {Function} */ handler,
        /** @type {boolean | AddEventListenerOptions} */ options
      ) => delegator.off(root, eventType, selector, handler, options),
      delegate: (
        /** @type {DelegationRoot} */ root,
        /** @type {string} */ eventType,
        /** @type {string} */ selector,
        /** @type {Function} */ handler,
        /** @type {boolean | AddEventListenerOptions} */ options
      ) => delegator.on(root, eventType, selector, handler, options),
      undelegate: (
        /** @type {DelegationRoot} */ root,
        /** @type {string} */ eventType,
        /** @type {string} */ selector,
        /** @type {Function} */ handler,
        /** @type {boolean | AddEventListenerOptions} */ options
      ) => delegator.off(root, eventType, selector, handler, options),
      getStats: () => delegator.getStats(),
      clear: () => delegator.clear(),
      attachHoverPopover,
    });

  window.YouTubePlusEventDelegation = surface;
})();
