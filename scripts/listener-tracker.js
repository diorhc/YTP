// @ts-check

/**
 * Canonical EventTarget Listener Tracker
 *
 * Implements listener tracker contract:
 * - Single tracker implementation for browser benchmark, in-page benchmarks, and unit tests.
 * - Proper listener identity: (type, callback, capture).
 * - Tracks options: boolean useCapture, { capture, once, signal, passive }.
 * - Automatically decrements count on once invocation.
 * - Automatically decrements count on AbortSignal 'abort'.
 * - Uses WeakMap for EventTarget instances: does NOT retain targets in memory.
 * - FinalizationRegistry cleans up counts if an uncleaned target is GC'd.
 * - Discloses heap and GC measurement limitations.
 */

const LISTENER_TRACKER_SCRIPT = `
(() => {
  if (window.__ytpTrackerInstalled__) return;
  window.__ytpTrackerInstalled__ = true;

  // WeakMap<EventTarget, Map<string, Map<any, {captures:Set<boolean>, onceWrappers:Map<boolean,Function>}>>>
  // target -> type -> listener -> { captures, onceWrappers }
  const targetMap = new WeakMap();
  // Iterable registry of live targets (WeakRefs) so restore can
  // reconcile live once-wrappers without retaining any target strongly.
  const liveTargets = typeof WeakRef === 'function' ? new Set() : null;
  let totalCount = 0;

  const registry = typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry((heldToken) => {
        // The held value is the token object itself — subtract its
        // numeric count, NOT the object (subtracting an object yields NaN).
        const held = heldToken && typeof heldToken === 'object' ? Number(heldToken.count) || 0 : 0;
        totalCount = Math.max(0, totalCount - held);
      })
    : null;

  const targetTokens = new WeakMap();

  function getTargetBucket(target) {
    let typeMap = targetMap.get(target);
    if (!typeMap) {
      typeMap = new Map();
      targetMap.set(target, typeMap);
      if (liveTargets) liveTargets.add(new WeakRef(target));
      if (registry) {
        const token = { count: 0 };
        targetTokens.set(target, token);
        try {
          registry.register(target, token, token);
        } catch (_e) {}
      }
    }
    return typeMap;
  }

  const ET = typeof EventTarget !== 'undefined' ? EventTarget : (window && window.EventTarget);
  const proto = ET ? ET.prototype : null;

  const hookTargets = [];
  if (proto && typeof proto.addEventListener === 'function') {
    hookTargets.push(proto);
  }
  if (window && typeof window.addEventListener === 'function' && (!proto || window.addEventListener !== proto.addEventListener)) {
    hookTargets.push(window);
  }
  const doc = typeof document !== 'undefined' ? document : (window && window.document);
  if (doc && typeof doc.addEventListener === 'function' && (!proto || doc.addEventListener !== proto.addEventListener)) {
    hookTargets.push(doc);
  }

  const originals = [];
  let inHook = false;

  for (const targetObj of hookTargets) {
    const origAdd = targetObj.addEventListener;
    const origRemove = targetObj.removeEventListener;
    originals.push({ targetObj, origAdd, origRemove });

    targetObj.addEventListener = function(type, listener, options) {
      if (inHook || !listener || (typeof listener !== 'function' && typeof listener.handleEvent !== 'function')) {
        return origAdd.call(this, type, listener, options);
      }

      inHook = true;
      try {
        const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
        const once = Boolean(options && typeof options === 'object' && options.once);
        const signal = options && typeof options === 'object' ? options.signal : null;

        if (signal && signal.aborted) {
          return;
        }

        const typeMap = getTargetBucket(this);
        let listenerMap = typeMap.get(type);
        if (!listenerMap) {
          listenerMap = new Map();
          typeMap.set(type, listenerMap);
        }

        let entry = listenerMap.get(listener);
        if (!entry) {
          entry = { captures: new Set(), onceWrappers: new Map(), optionsByCapture: new Map() };
          listenerMap.set(listener, entry);
        }

        if (entry.captures.has(capture)) {
          // Native addEventListener dedupes identical
          // (type, callback, capture) triples — a repeated add is a no-op.
          // For an already-tracked once registration the WRAPPER is what is
          // registered natively, so adding the original callback again would
          // create a SECOND native listener that fires in addition to the
          // wrapper. Mirror native semantics: re-adding is a no-op.
          return;
        }

        entry.captures.add(capture);
        entry.optionsByCapture.set(capture, {
          capture, once,
          ...(options && typeof options === 'object' ? { passive: options.passive, signal } : {}),
        });
        totalCount++;
        const token = targetTokens.get(this);
        if (token) token.count++;

        // Handle signal auto-removal. The abort listener's closure must not
        // strongly retain the target (a long-lived shared signal would keep
        // the target alive) — hold it through a WeakRef instead.
        if (signal && typeof signal.addEventListener === 'function') {
          const selfRef = typeof WeakRef === 'function' ? new WeakRef(this) : null;
          const onAbort = () => {
            try {
              // The only fallback is the WeakRef. A fallback without WeakRef
              // would remove from the global scope instead of the target element.
              selfRef?.deref()?.removeEventListener(type, listener, options);
            } catch (_e) {}
          };
          try {
            origAdd.call(signal, 'abort', onAbort, { once: true });
          } catch (_e) {}
          // The abort subscription belongs to THIS registration identity.
          // An early manual remove must unsubscribe it symmetrically, otherwise
          // a later re-add leaves a stale abort listener that strips the NEW
          // registration (remove→re-add→old abort counterexample).
          entry.abortSubscriptions = entry.abortSubscriptions || new Map();
          entry.abortSubscriptions.set(capture, { signal, onAbort });
        }

        // Handle once auto-removal
        if (once) {
          const origListener = listener;
          const onceWrapper = function(...args) {
            try {
              this.removeEventListener(type, origListener, options);
            } catch (_e) {}
            if (typeof origListener === 'function') {
              return origListener.apply(this, args);
            } else if (origListener && typeof origListener.handleEvent === 'function') {
              return origListener.handleEvent(...args);
            }
          };
          entry.onceWrappers.set(capture, onceWrapper);
          const nativeOpts = typeof options === 'object' ? Object.assign({}, options, { once: false }) : options;
          return origAdd.call(this, type, onceWrapper, nativeOpts);
        }

        return origAdd.call(this, type, listener, options);
      } finally {
        inHook = false;
      }
    };

    targetObj.removeEventListener = function(type, listener, options) {
      if (inHook || !listener) {
        return origRemove.call(this, type, listener, options);
      }

      inHook = true;
      try {
        const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
        const typeMap = targetMap.get(this);
        let toRemove = listener;
        if (typeMap) {
          const listenerMap = typeMap.get(type);
          if (listenerMap) {
            const entry = listenerMap.get(listener);
            if (entry && entry.captures && entry.captures.has(capture)) {
              entry.captures.delete(capture);
              entry.optionsByCapture.delete(capture);
              totalCount = Math.max(0, totalCount - 1);
              const token = targetTokens.get(this);
              if (token) token.count = Math.max(0, token.count - 1);
              // Symmetric abort-subscription removal — this registration's
              // abort listener must not outlive it (early remove case).
              if (entry.abortSubscriptions && entry.abortSubscriptions.has(capture)) {
                const sub = entry.abortSubscriptions.get(capture);
                entry.abortSubscriptions.delete(capture);
                try {
                  sub.signal.removeEventListener('abort', sub.onAbort);
                } catch (_e) {}
              }
              if (entry.onceWrappers && entry.onceWrappers.has(capture)) {
                toRemove = entry.onceWrappers.get(capture);
                entry.onceWrappers.delete(capture);
              }
              if (entry.captures.size === 0) {
                listenerMap.delete(listener);
              }
            }
            if (listenerMap.size === 0) {
              typeMap.delete(type);
            }
          }
        }

        return origRemove.call(this, type, toRemove, options);
      } finally {
        inHook = false;
      }
    };
  }

  window.__ytpGetListenerCount = () => totalCount;
  window.__ytpGetTargetListenerCount = (target) => {
    const typeMap = targetMap.get(target);
    if (!typeMap) return 0;
    let count = 0;
    for (const listenerMap of typeMap.values()) {
      for (const entry of listenerMap.values()) {
        // The stored value is { captures, onceWrappers }, not a Set —
        // sum the size of the captures set.
        count += entry.captures.size;
      }
    }
    return count;
  };

  window.__ytpRestoreListenerTracker = () => {
    // Restore is for teardown: replacing wrappers can change listener order.
    // Saved native methods avoid the tracker's own duplicate suppression.
    const native = originals[0];
    for (const targetRef of liveTargets || []) {
      const target = targetRef.deref();
      if (!target || !native) continue;
      const typeMap = targetMap.get(target);
      if (!typeMap) continue;
      for (const [type, listenerMap] of typeMap) {
        for (const [listener, entry] of listenerMap) {
          for (const sub of entry.abortSubscriptions?.values() || []) {
            native.origRemove.call(sub.signal, 'abort', sub.onAbort);
          }
          for (const [capture, wrapper] of entry.onceWrappers) {
            native.origRemove.call(target, type, wrapper, capture);
            native.origAdd.call(target, type, listener, entry.optionsByCapture.get(capture));
          }
        }
      }
    }
    liveTargets?.clear();
    for (const { targetObj, origAdd, origRemove } of originals) {
      targetObj.addEventListener = origAdd;
      targetObj.removeEventListener = origRemove;
    }
    delete window.__ytpTrackerInstalled__;
    delete window.__ytpGetListenerCount;
    delete window.__ytpGetTargetListenerCount;
    delete window.__ytpRestoreListenerTracker;
  };
})();
`;

/**
 * Installs the listener tracker on a target Window/global object.
 * @param {any} targetWindow
 */
function installListenerTracker(
  targetWindow = (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).window) ||
    globalThis
) {
  if (targetWindow.__ytpTrackerInstalled__) {
    return {
      getTotalCount: () => targetWindow.__ytpGetListenerCount(),
      getTargetCount: t => targetWindow.__ytpGetTargetListenerCount(t),
      restore: () => targetWindow.__ytpRestoreListenerTracker?.(),
    };
  }

  const fn = new Function('window', 'document', 'EventTarget', LISTENER_TRACKER_SCRIPT);
  fn(targetWindow, targetWindow.document, targetWindow.EventTarget);

  return {
    getTotalCount: () =>
      typeof targetWindow.__ytpGetListenerCount === 'function'
        ? targetWindow.__ytpGetListenerCount()
        : 0,
    getTargetCount: t =>
      typeof targetWindow.__ytpGetTargetListenerCount === 'function'
        ? targetWindow.__ytpGetTargetListenerCount(t)
        : 0,
    restore: () => {
      if (typeof targetWindow.__ytpRestoreListenerTracker === 'function') {
        targetWindow.__ytpRestoreListenerTracker();
      }
    },
  };
}

module.exports = {
  installListenerTracker,
};
