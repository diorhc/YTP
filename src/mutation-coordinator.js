// Global MutationObserver coordinator - single root observer with subscription API
(function () {
  'use strict';

  if (typeof window === 'undefined' || window.YouTubeMutationCoordinator) return;

  /**
   * @typedef {{
   *   id: string,
   *   callback: (mutations: MutationRecord[]) => void,
   *   selector: string | null,
   *   attributes: boolean,
   *   childList: boolean,
   *   subtree: boolean,
   *   attributeFilter: string[] | null
   * }} RootSubscription
   */

  /** @type {Map<string, RootSubscription>} */
  const rootSubscriptions = new Map();
  /** @type {MutationObserver | null} */
  let rootObserver = null;
  let rafScheduled = false;
  /** @type {MutationRecord[]} */
  let pendingMutations = [];
  /** @type {MutationObserverInit | null} */
  let currentObserveConfig = null;

  /**
   * @typedef {{
   *   selector?: string | null,
   *   attributes?: boolean,
   *   childList?: boolean,
   *   subtree?: boolean,
   *   attributeFilter?: string[] | null
   * }} SubscriptionOptions
   */

  /** @param {MutationObserverInit | null} config */
  const configKey = config => (config ? JSON.stringify(config) : 'null');

  const shouldNotifySelector = (
    /** @type {string | null} */ selector,
    /** @type {MutationRecord[]} */ mutations
  ) => {
    if (!selector) return true;

    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof Element && (target.matches(selector) || target.closest(selector))) {
        return true;
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(selector) || node.querySelector(selector)) return true;
      }
    }

    return false;
  };

  /** @param {RootSubscription} sub @param {MutationRecord[]} batch */
  const filterMutationsForSubscription = (sub, batch) => {
    const out = [];
    for (const mutation of batch) {
      if (mutation.type === 'attributes') {
        if (!sub.attributes) continue;
        if (
          sub.attributeFilter &&
          sub.attributeFilter.length > 0 &&
          mutation.attributeName &&
          !sub.attributeFilter.includes(mutation.attributeName)
        ) {
          continue;
        }
      }
      if (mutation.type === 'childList' && !sub.childList) continue;
      out.push(mutation);
    }
    return out;
  };

  const flush = () => {
    rafScheduled = false;
    if (pendingMutations.length === 0) return;

    const batch = pendingMutations;
    pendingMutations = [];

    for (const sub of rootSubscriptions.values()) {
      try {
        if (!shouldNotifySelector(sub.selector, batch)) continue;
        const filtered = filterMutationsForSubscription(sub, batch);
        if (filtered.length > 0) {
          sub.callback(filtered);
        }
      } catch (e) {
        window.console.error('[MutationCoordinator] subscriber failed:', e);
      }
    }
  };

  /** @returns {MutationObserverInit} */
  const computeObserveConfig = () => {
    let childList = false;
    let attributes = false;
    let hasUnlimitedAttributeFilter = false;
    /** @type {Set<string>} */
    const attrSet = new Set();

    for (const sub of rootSubscriptions.values()) {
      childList = childList || sub.childList;
      attributes = attributes || sub.attributes;
      if (sub.attributes) {
        if (!sub.attributeFilter || sub.attributeFilter.length === 0) {
          hasUnlimitedAttributeFilter = true;
        } else {
          for (const attr of sub.attributeFilter) attrSet.add(attr);
        }
      }
    }

    return {
      childList,
      subtree: true,
      attributes,
      attributeFilter:
        attributes && !hasUnlimitedAttributeFilter && attrSet.size > 0 ? [...attrSet] : undefined,
    };
  };

  /** @param {MutationObserverInit} nextConfig */
  const ensureRootObserver = nextConfig => {
    const target = document.body || document.documentElement;
    if (!target) return;

    if (!rootObserver) {
      rootObserver = new MutationObserver(mutations => {
        pendingMutations.push(...mutations);
        if (rafScheduled) return;
        rafScheduled = true;
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(flush);
        } else {
          setTimeout(flush, 0);
        }
      });
    }

    if (configKey(currentObserveConfig) === configKey(nextConfig)) {
      return;
    }

    rootObserver.disconnect();
    rootObserver.observe(target, nextConfig);
    currentObserveConfig = nextConfig;
  };

  const refreshObserver = () => {
    if (rootSubscriptions.size === 0) {
      if (rootObserver) {
        rootObserver.disconnect();
        rootObserver = null;
      }
      currentObserveConfig = null;
      pendingMutations = [];
      rafScheduled = false;
      return;
    }

    ensureRootObserver(computeObserveConfig());
  };

  /**
   * @param {Node} target
   * @param {MutationRecord} mutation
   * @param {{subtree?: boolean, childList?: boolean, attributes?: boolean, attributeFilter?: string[]|null}} options
   */
  const mutationTouchesTarget = (target, mutation, options) => {
    const allowSubtree = options.subtree !== false;

    if (mutation.type === 'attributes') {
      if (!options.attributes) return false;
      if (
        options.attributeFilter &&
        options.attributeFilter.length > 0 &&
        mutation.attributeName &&
        !options.attributeFilter.includes(mutation.attributeName)
      ) {
        return false;
      }
      if (mutation.target === target) return true;
      if (!allowSubtree) return false;
      return target instanceof Element && target.contains(mutation.target);
    }

    if (mutation.type === 'childList') {
      if (!options.childList) return false;
      if (mutation.target === target) return true;
      if (!allowSubtree) return false;
      if (target instanceof Element && target.contains(mutation.target)) return true;
      for (const node of mutation.addedNodes) {
        if (node === target) return true;
        if (target instanceof Element && node instanceof Element && target.contains(node)) {
          return true;
        }
      }
      for (const node of mutation.removedNodes) {
        if (node === target) return true;
      }
    }

    return false;
  };

  /**
   * @typedef {{
   *   subscribeRoot: (id: string, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   unsubscribe: (id: string) => void,
   *   watchTarget: (id: string, target: Node, callback: (mutations: MutationRecord[]) => void, options?: SubscriptionOptions) => string | null,
   *   unwatch: (id: string) => void,
   *   getStats: () => { rootSubscribers: number, rootObserverActive: boolean }
   * }} MutationCoordinatorApi
   */

  /** @type {MutationCoordinatorApi} */
  const api = {
    subscribeRoot(
      /** @type {string} */ id,
      /** @type {(mutations: MutationRecord[]) => void} */ callback,
      /** @type {SubscriptionOptions} */ options = {}
    ) {
      if (!id || typeof callback !== 'function') return null;
      rootSubscriptions.set(id, {
        id,
        callback,
        selector: typeof options.selector === 'string' ? options.selector : null,
        attributes: options.attributes === true,
        childList: options.childList !== false,
        subtree: options.subtree !== false,
        attributeFilter: Array.isArray(options.attributeFilter)
          ? options.attributeFilter.filter(
              (/** @type {unknown} */ a) => typeof a === 'string' && a.length > 0
            )
          : null,
      });
      refreshObserver();
      return id;
    },

    unsubscribe(/** @type {string} */ id) {
      if (!id) {
        return;
      }
      rootSubscriptions.delete(id);
      refreshObserver();
    },

    watchTarget(
      /** @type {string} */ id,
      /** @type {Node} */ target,
      /** @type {(mutations: MutationRecord[]) => void} */ callback,
      /** @type {SubscriptionOptions} */ options = {}
    ) {
      if (!id || !(target instanceof Node) || typeof callback !== 'function') return null;
      const normalized = {
        attributes: options.attributes !== false,
        childList: options.childList !== false,
        subtree: options.subtree !== false,
        attributeFilter: Array.isArray(options.attributeFilter)
          ? options.attributeFilter.filter(
              (/** @type {unknown} */ a) => typeof a === 'string' && a.length > 0
            )
          : null,
      };

      return api.subscribeRoot(
        id,
        (/** @type {MutationRecord[]} */ mutations) => {
          const filtered = mutations.filter((/** @type {MutationRecord} */ m) =>
            mutationTouchesTarget(target, m, normalized)
          );
          if (filtered.length > 0) {
            callback(filtered);
          }
        },
        {
          selector: typeof options.selector === 'string' ? options.selector : null,
          attributes: normalized.attributes,
          childList: normalized.childList,
          subtree: true,
          attributeFilter: normalized.attributeFilter,
        }
      );
    },

    unwatch(/** @type {string} */ id) {
      api.unsubscribe(id);
    },

    getStats() {
      return {
        rootSubscribers: rootSubscriptions.size,
        rootObserverActive: !!rootObserver,
      };
    },
  };

  window.YouTubeMutationCoordinator = api;
})();
