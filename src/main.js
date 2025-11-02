/**
 * Identity function that returns the input value unchanged
 * @param {*} value - The value to return
 * @returns {*} The same value
 */
// @ts-nocheck

const identityFn = value => value; /**
 * Ensure TrustedTypes policy exists for secure HTML handling
 * @returns {{createHTML: Function, error: Error|null}} Policy object with createHTML function and error status
 */
function ensureTrustedTypesPolicy() {
  if (typeof trustedTypes === 'undefined') {
    return { createHTML: identityFn, error: null };
  }

  try {
    if (trustedTypes.defaultPolicy === null) {
      trustedTypes.createPolicy('default', {
        createHTML: identityFn,
        createScriptURL: identityFn,
        createScript: identityFn,
      });
    }

    const policy = trustedTypes.defaultPolicy;
    const createHTML =
      policy && typeof policy.createHTML === 'function'
        ? policy.createHTML.bind(policy)
        : identityFn;

    // Validate policy works
    const testDiv = document.createElement('div');
    testDiv.innerHTML = createHTML('1');
    return { createHTML, error: null };
  } catch (error) {
    console.error('TrustedTypes policy creation failed:', error);
    return { createHTML: identityFn, error };
  }
}

/**
 * Create browser tick scheduler for microtask execution
 * @param {Function} existing - Existing scheduler to reuse if version compatible
 * @returns {Function} Scheduler function with version property
 */
function createNextBrowserTick(existing) {
  if (existing && typeof existing === 'function' && existing.version >= 2) {
    return existing;
  }

  const SafePromise = (async () => {})().constructor;
  const queue =
    typeof queueMicrotask === 'function'
      ? callback => queueMicrotask(callback)
      : callback => SafePromise.resolve().then(callback);

  const scheduler = callback => {
    if (typeof callback === 'function') {
      queue(callback);
      return;
    }
    return SafePromise.resolve();
  };

  scheduler.version = 2;
  return scheduler;
}

const { createHTML, error: trustHTMLErr } = ensureTrustedTypesPolicy();

if (trustHTMLErr) {
  console.error(
    '[YouTube+] TrustedHTML Error: Script cannot run due to Content Security Policy restrictions',
    trustHTMLErr
  );
  throw new Error('CSP restriction - cannot initialize TrustedTypes');
}

// Export createHTML for use in modules if needed
if (typeof window !== 'undefined') {
  window._ytplusCreateHTML = createHTML;
}

const nextBrowserTick = createNextBrowserTick(
  (typeof window !== 'undefined' && window.nextBrowserTick) || undefined
);

if (
  typeof window !== 'undefined' &&
  (!window.nextBrowserTick || window.nextBrowserTick.version < 2)
) {
  window.nextBrowserTick = nextBrowserTick;
}

// -----------------------------------------------------------------------------------------------------------------------------

/**
 * Main execution script for YouTube tab view
 * @param {string} _communicationKey - Unique key for cross-context communication (reserved for future use)
 */
const executionScript = _communicationKey => {
  /** @const {boolean} Debug flag for attachment/detachment events */
  const DEBUG_5084 = false;

  /** @const {boolean} Debug flag for tab operations */
  const DEBUG_5085 = false;

  /** @const {boolean} Auto-switch to comments tab when available */
  const DEBUG_handleNavigateFactory = false;
  const TAB_AUTO_SWITCH_TO_COMMENTS = false;

  // Configuration validation
  /** @const {number} Maximum value for attributes before overflow reset */
  const MAX_ATTRIBUTE_VALUE = 1e9;

  /** @const {number} Reset value when attribute exceeds max */
  const ATTRIBUTE_RESET_VALUE = 9;

  // Validate configuration
  if (
    MAX_ATTRIBUTE_VALUE <= 0 ||
    ATTRIBUTE_RESET_VALUE < 0 ||
    ATTRIBUTE_RESET_VALUE >= MAX_ATTRIBUTE_VALUE
  ) {
    console.error(
      '[YouTube+] Invalid configuration: MAX_ATTRIBUTE_VALUE and ATTRIBUTE_RESET_VALUE must be valid positive numbers'
    );
  } // Reuse utility functions from parent scope
  const identityFn = value => value;
  const ensureTrustedTypesPolicyLocal = () => {
    if (typeof trustedTypes === 'undefined') {
      return { createHTML: identityFn, error: null };
    }

    try {
      if (trustedTypes.defaultPolicy === null) {
        trustedTypes.createPolicy('default', {
          createHTML: identityFn,
          createScriptURL: identityFn,
          createScript: identityFn,
        });
      }

      const policy = trustedTypes.defaultPolicy;
      const createHTML = policy?.createHTML?.bind?.(policy) ?? identityFn;

      // Validate policy works
      const testDiv = document.createElement('div');
      testDiv.innerHTML = createHTML('1');
      return { createHTML, error: null };
    } catch (error) {
      console.error('[YouTube+] TrustedTypes local policy failed:', error);
      return { createHTML: identityFn, error };
    }
  };

  /**
   * Create browser tick scheduler for microtask execution
   * @param {Function} existing - Existing scheduler to reuse if version compatible
   * @returns {Function} Scheduler function
   */
  const createNextBrowserTickLocal = existing => {
    if (existing?.version >= 2) {
      return existing;
    }

    const SafePromise = (async () => {})().constructor;
    const queue =
      typeof queueMicrotask === 'function'
        ? callback => queueMicrotask(callback)
        : callback => SafePromise.resolve().then(callback);

    const scheduler = callback => {
      if (typeof callback === 'function') {
        queue(callback);
        return;
      }
      return SafePromise.resolve();
    };

    scheduler.version = 2;
    return scheduler;
  };

  const { createHTML, error: trustHTMLErr } = ensureTrustedTypesPolicyLocal();

  if (trustHTMLErr) {
    console.error(
      '[YouTube+] TrustedHTML Error: Script cannot run due to CSP restrictions',
      trustHTMLErr
    );
    return; // Exit execution script gracefully
  }

  const nextBrowserTick = createNextBrowserTickLocal(
    (typeof window !== 'undefined' && window.nextBrowserTick) || undefined
  );

  if (
    typeof window !== 'undefined' &&
    (!window.nextBrowserTick || window.nextBrowserTick.version < 2)
  ) {
    window.nextBrowserTick = nextBrowserTick;
  }

  try {
    let executionFinished = 0;

    if (typeof CustomElementRegistry === 'undefined') return;
    if (CustomElementRegistry.prototype.define000) return;
    if (typeof CustomElementRegistry.prototype.define !== 'function') return;

    /** @type {HTMLElement} HTMLElement constructor reference */
    const HTMLElement_ = HTMLElement.prototype.constructor;

    /**
     * Simple cache for frequently used querySelector results
     * Helps reduce DOM traversal overhead
     */
    const selectorCache = new Map();
    // eslint-disable-next-line no-unused-vars
    const _CACHE_MAX_SIZE = 50; // Reserved for future cache implementation
    const CACHE_TTL = 5000; // 5 seconds

    /**
     * Clear expired cache entries
     */
    const clearExpiredCache = () => {
      const now = Date.now();
      for (const [key, value] of selectorCache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          selectorCache.delete(key);
        }
      }
    };

    // Periodically clear expired cache
    setInterval(clearExpiredCache, CACHE_TTL);

    /**
     * Query single element from a specific parent
     * @param {Element} elm - Parent element to query from
     * @param {string} selector - CSS selector string
     * @returns {Element | null} Found element or null
     */
    const qsOne = (elm, selector) => {
      return HTMLElement_.prototype.querySelector.call(elm, selector);
    };

    /**
     * Query all matching elements from a specific parent
     * @param {Element} elm - Parent element to query from
     * @param {string} selector - CSS selector string
     * @returns {NodeListOf<Element>} NodeList of found elements
     */
    // eslint-disable-next-line no-unused-vars
    const _qsAll = (elm, selector) => {
      return HTMLElement_.prototype.querySelectorAll.call(elm, selector);
    };

    const pdsBaseDF = Object.getOwnPropertyDescriptors(DocumentFragment.prototype);

    Object.defineProperties(DocumentFragment.prototype, {
      replaceChildren000: pdsBaseDF.replaceChildren,
    });

    const pdsBaseNode = Object.getOwnPropertyDescriptors(Node.prototype);

    Object.defineProperties(Node.prototype, {
      appendChild000: pdsBaseNode.appendChild,
      insertBefore000: pdsBaseNode.insertBefore,
    });

    const pdsBaseElement = Object.getOwnPropertyDescriptors(Element.prototype);

    Object.defineProperties(Element.prototype, {
      setAttribute000: pdsBaseElement.setAttribute,
      getAttribute000: pdsBaseElement.getAttribute,
      hasAttribute000: pdsBaseElement.hasAttribute,
      removeAttribute000: pdsBaseElement.removeAttribute,
      querySelector000: pdsBaseElement.querySelector,
      replaceChildren000: pdsBaseElement.replaceChildren,
    });

    /**
     * Set attribute only if value has changed (optimization to reduce DOM operations)
     * @param {string} p - Attribute name
     * @param {*} v - Attribute value
     */
    Element.prototype.setAttribute111 = function (p, v) {
      if (!p || typeof p !== 'string') {
        console.warn('[YouTube+] setAttribute111: invalid attribute name', p);
        return;
      }
      try {
        v = `${v}`;
        if (this.getAttribute000(p) === v) return;
        this.setAttribute000(p, v);
      } catch (error) {
        console.warn('[YouTube+] setAttribute111 failed:', error, p, v);
      }
    };

    /**
     * Increment attribute value (with overflow protection)
     * @param {string} p - Attribute name
     * @returns {number} New attribute value
     */
    Element.prototype.incAttribute111 = function (p) {
      if (!p || typeof p !== 'string') {
        console.warn('[YouTube+] incAttribute111: invalid attribute name', p);
        return 0;
      }
      try {
        let v = +this.getAttribute000(p) || 0;
        v = v > MAX_ATTRIBUTE_VALUE ? ATTRIBUTE_RESET_VALUE : v + 1;
        this.setAttribute000(p, `${v}`);
        return v;
      } catch (error) {
        console.warn('[YouTube+] incAttribute111 failed:', error, p);
        return 0;
      }
    };

    /**
     * Assign children elements in specific order while managing DOM efficiently
     * @param {Array<Node>|null} previousSiblings - Nodes to place before target node
     * @param {Node} node - Target node (required)
     * @param {Array<Node>|null} nextSiblings - Nodes to place after target node
     */
    Element.prototype.assignChildren111 = function (previousSiblings, node, nextSiblings) {
      if (!node) {
        console.warn('[YouTube+] assignChildren111: node is required');
        return;
      }

      try {
        // Collect all child nodes except the target node
        let nodeList = [];
        for (let t = this.firstChild; t instanceof Node; t = t.nextSibling) {
          if (t === node) continue;
          nodeList.push(t);
        }

        inPageRearrange = true;

        if (node.parentNode === this) {
          // Node is already a child, rearrange efficiently
          let fm = new DocumentFragment();

          if (nodeList.length > 0) {
            fm.replaceChildren000(...nodeList);
          }

          if (previousSiblings?.length > 0) {
            fm.replaceChildren000(...previousSiblings);
            this.insertBefore000(fm, node);
          }

          if (nextSiblings?.length > 0) {
            fm.replaceChildren000(...nextSiblings);
            this.appendChild000(fm);
          }

          fm.replaceChildren000();
          fm = null;
        } else {
          // Node is not a child yet, replace all children
          this.replaceChildren000(...(previousSiblings || []), node, ...(nextSiblings || []));
        }

        inPageRearrange = false;

        // Cleanup disconnected nodes
        if (nodeList.length > 0) {
          for (const t of nodeList) {
            if (t instanceof Element && t.isConnected === false) {
              t.remove(); // Trigger removal events
            }
          }
        }

        nodeList.length = 0;
        nodeList = null;
      } catch (error) {
        inPageRearrange = false;
        console.error('[YouTube+] assignChildren111 failed:', error);
      }
    };

    // ==============================================================================================================================================================================================================================================================================

    const DISABLE_FLAGS_SHADYDOM_FREE = true;

    /**
     *
     * Minified Code from https://greasyfork.org/en/scripts/475632-ytconfighacks/code (ytConfigHacks)
     * Date: 2024.04.17
     * Minifier: https://www.toptal.com/developers/javascript-minifier
     *
     */
    (() => {
      const e =
        'undefined' != typeof unsafeWindow ? unsafeWindow : this instanceof Window ? this : window;
      if (!e._ytConfigHacks) {
        let t = 4;
        class n extends Set {
          add(e) {
            if (t <= 0) return console.warn('yt.config_ is already applied on the page.');
            'function' == typeof e && super.add(e);
          }
        }
        const a = (async () => {})().constructor,
          i = (e._ytConfigHacks = new n());
        let l = () => {
          const t = e.ytcsi.originalYtcsi;
          t && ((e.ytcsi = t), (l = null));
        };
        let c = null;
        const o = () => {
          if (t >= 1) {
            const n = (e.yt || 0).config_ || (e.ytcfg || 0).data_ || 0;
            if ('string' == typeof n.INNERTUBE_API_KEY && 'object' == typeof n.EXPERIMENT_FLAGS) {
              for (const a of (--t <= 0 && l && l(), (c = !0), i)) a(n);
            }
          }
        };
        let f = 1;
        const d = t => {
          if ((t = t || e.ytcsi)) {
            return (
              (e.ytcsi = new Proxy(t, {
                get: (e, t) => ('originalYtcsi' === t ? e : (o(), c && --f <= 0 && l && l(), e[t])),
              })),
              !0
            );
          }
        };
        d() ||
          Object.defineProperty(e, 'ytcsi', {
            get() {},
            set: t => (t && (delete e.ytcsi, d(t)), !0),
            enumerable: !1,
            configurable: !0,
          });
        const { addEventListener: s, removeEventListener: y } = Document.prototype;
        function r(t) {
          (o(), t && e.removeEventListener('DOMContentLoaded', r, !1));
        }
        (new a(e => {
          if ('undefined' != typeof AbortSignal) {
            (s.call(document, 'yt-page-data-fetched', e, { once: !0 }),
              s.call(document, 'yt-navigate-finish', e, { once: !0 }),
              s.call(document, 'spfdone', e, { once: !0 }));
          } else {
            const t = () => {
              (e(),
                y.call(document, 'yt-page-data-fetched', t, !1),
                y.call(document, 'yt-navigate-finish', t, !1),
                y.call(document, 'spfdone', t, !1));
            };
            (s.call(document, 'yt-page-data-fetched', t, !1),
              s.call(document, 'yt-navigate-finish', t, !1),
              s.call(document, 'spfdone', t, !1));
          }
        }).then(o),
          new a(e => {
            if ('undefined' != typeof AbortSignal) {
              s.call(document, 'yt-action', e, { once: !0, capture: !0 });
            } else {
              const t = () => {
                (e(), y.call(document, 'yt-action', t, !0));
              };
              s.call(document, 'yt-action', t, !0);
            }
          }).then(o),
          a.resolve().then(() => {
            'loading' !== document.readyState ? r() : e.addEventListener('DOMContentLoaded', r, !1);
          }));
      }
    })();

    let configOnce = false;
    window._ytConfigHacks.add(config_ => {
      if (configOnce) return;
      configOnce = true;

      const EXPERIMENT_FLAGS = config_.EXPERIMENT_FLAGS || 0;
      const EXPERIMENTS_FORCED_FLAGS = config_.EXPERIMENTS_FORCED_FLAGS || 0;
      for (const flags of [EXPERIMENT_FLAGS, EXPERIMENTS_FORCED_FLAGS]) {
        if (flags) {
          // flags.kevlar_watch_metadata_refresh_no_old_secondary_data = false;
          // flags.live_chat_overflow_hide_chat = false;
          flags.web_watch_chat_hide_button_killswitch = false;
          flags.web_watch_theater_chat = false; // for re-openable chat (ytd-watch-flexy's liveChatCollapsed is always undefined)
          flags.suppress_error_204_logging = true;
          flags.kevlar_watch_grid = false; // A/B testing for watch grid

          if (DISABLE_FLAGS_SHADYDOM_FREE) {
            flags.enable_shadydom_free_scoped_node_methods = false;
            flags.enable_shadydom_free_scoped_query_methods = false;
            flags.enable_shadydom_free_scoped_readonly_properties_batch_one = false;
            flags.enable_shadydom_free_parent_node = false;
            flags.enable_shadydom_free_children = false;
            flags.enable_shadydom_free_last_child = false;
          }
        }
      }
    });

    // ===================================================================================================================================================================================================================================
    /* globals WeakRef:false */

    /** @type {(o: Object | null) => WeakRef | null} */
    const mWeakRef =
      typeof WeakRef === 'function' ? o => (o ? new WeakRef(o) : null) : o => o || null; // typeof InvalidVar == 'undefined'

    /** @type {(wr: Object | null) => Object | null} */
    const kRef = wr => (wr && wr.deref ? wr.deref() : wr);

    /** @type {globalThis.PromiseConstructor} */
    /** @type {PromiseConstructor} Safe Promise constructor (YouTube hacks Promise in WaterFox Classic) */
    const Promise = (async () => {})().constructor;

    /**
     * Create a promise that resolves after a delay
     * @param {number} delay - Delay in milliseconds
     * @returns {Promise<void>} Promise that resolves after the delay
     */
    const delayPn = delay => new Promise(fn => setTimeout(fn, delay));

    /**
     * Get polymer controller or instance from element
     * @param {*} o - Element or object to inspect
     * @returns {*} Polymer controller, instance, or the object itself
     */
    const insp = o => (o ? o.polymerController || o.inst || o || 0 : o || 0);

    /** @type {Function} Bound setTimeout to ensure correct context */
    const setTimeout_ = setTimeout.bind(window);

    /**
     * Error handler for promises - logs errors with context
     * @param {Error} error - The error that occurred
     * @param {string} context - Context information about where the error occurred
     */
    const handlePromiseError = (error, context = 'Unknown') => {
      if (error) {
        console.error(`[YouTube+] Promise error in ${context}:`, error);
      }
    };

    /**
     * Promise class with external resolve/reject methods
     * Useful for creating deferred promises that can be resolved externally
     */
    const PromiseExternal = ((resolve_, reject_) => {
      const h = (resolve, reject) => {
        resolve_ = resolve;
        reject_ = reject;
      };
      return class PromiseExternal extends Promise {
        constructor(cb = h) {
          super(cb);
          if (cb === h) {
            /** @type {(value: any) => void} */
            this.resolve = resolve_;
            /** @type {(reason?: any) => void} */
            this.reject = reject_;
          }
        }
      };
    })();

    // ------------------------------------------------------------------------ Event Listener Options ------------------------------------------------------------------------

    /** @const {boolean} Check if passive event listeners are supported */
    const isPassiveArgSupport = typeof IntersectionObserver === 'function';

    /** @const {Object|boolean} Event listener options for bubble phase with passive */
    // eslint-disable-next-line no-unused-vars
    const _bubblePassive = isPassiveArgSupport ? { capture: false, passive: true } : false;

    /** @const {Object|boolean} Event listener options for capture phase with passive */
    const capturePassive = isPassiveArgSupport ? { capture: true, passive: true } : true;

    /**
     * Helper class to manage binary flags as string attributes
     */
    class Attributer {
      /**
       * @param {string} list - String where each character represents a flag
       */
      constructor(list) {
        this.list = list;
        this.flag = 0;
      }

      /**
       * Convert active flags to string representation
       * @returns {string} String with characters for active flags
       */
      makeString() {
        let k = 1;
        let s = '';
        let i = 0;
        while (this.flag >= k) {
          if (this.flag & k) {
            s += this.list[i];
          }
          i++;
          k <<= 1;
        }
        return s;
      }
    }

    /** @type {Attributer} Module loaded state tracker */
    const mLoaded = new Attributer('icp');

    /** @type {WeakMap} WeakMap for self-referencing objects */
    const wrSelfMap = new WeakMap();

    /**
     * Elements cache using Proxy with WeakRef for memory efficiency
     * Automatically manages element references and prevents memory leaks
     * @type {Object.<string, Element | null>}
     */
    const elements = new Proxy(
      {
        related: null,
        comments: null,
        infoExpander: null,
      },
      {
        get(target, prop) {
          return kRef(target[prop]);
        },
        set(target, prop, value) {
          if (value) {
            let wr = wrSelfMap.get(value);
            if (!wr) {
              wr = mWeakRef(value);
              wrSelfMap.set(value, wr);
            }
            target[prop] = wr;
          } else {
            target[prop] = null;
          }
          return true;
        },
      }
    );

    /**
     * Get the main info element from the infoExpander
     * @returns {Element|null} The main info element or null
     */
    const getMainInfo = () => {
      const infoExpander = elements.infoExpander;
      if (!infoExpander) return null;
      const mainInfo = infoExpander.matches('[tyt-main-info]')
        ? infoExpander
        : infoExpander.querySelector000('[tyt-main-info]');
      return mainInfo || null;
    };
    /**
     * Wrap async function to execute in next microtask
     * @param {Function} asyncFn - Async function to wrap
     * @returns {Function} Wrapped function
     */
    // eslint-disable-next-line no-unused-vars
    const _asyncWrap = asyncFn => {
      return () => {
        Promise.resolve().then(asyncFn);
      };
    };

    let pageType = null;

    let pageLang = 'en';
    /**
     * Localized strings for different languages
     * @type {Object.<string, Object.<string, string>>}
     */
    const langWords = {
      en: {
        info: 'Info',
        videos: 'Videos',
        playlist: 'Playlist',
      },
      jp: {
        info: '情報',
        videos: '動画',
        playlist: '再生リスト',
      },
      tw: {
        info: '資訊',
        videos: '影片',
        playlist: '播放清單',
      },
      cn: {
        info: '资讯',
        videos: '视频',
        playlist: '播放列表',
      },
      du: {
        info: 'Info',
        videos: 'Videos',
        playlist: 'Playlist',
      },
      fr: {
        info: 'Info',
        videos: 'Vidéos',
        playlist: 'Playlist',
      },
      kr: {
        info: '정보',
        videos: '동영상',
        playlist: '재생목록',
      },
      ru: {
        info: 'Описание',
        videos: 'Видео',
        playlist: 'Плейлист',
      },
    };

    const svgComments =
      `<path d="M80 27H12A12 12 90 0 0 0 39v42a12 12 90 0 0 12 12h12v20a2 2 90 0 0 3.4 2L47 93h33a12 
  12 90 0 0 12-12V39a12 12 90 0 0-12-12zM20 47h26a2 2 90 1 1 0 4H20a2 2 90 1 1 0-4zm52 28H20a2 2 90 1 1 0-4h52a2 2 90 
  1 1 0 4zm0-12H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm36-58H40a12 12 90 0 0-12 12v6h52c9 0 16 7 16 16v42h0v4l7 7a2 2 90 
  0 0 3-1V71h2a12 12 90 0 0 12-12V17a12 12 90 0 0-12-12z"/>`.trim();

    const svgVideos =
      `<path d="M89 10c0-4-3-7-7-7H7c-4 0-7 3-7 7v70c0 4 3 7 7 7h75c4 0 7-3 7-7V10zm-62 2h13v10H27V12zm-9 
  66H9V68h9v10zm0-56H9V12h9v10zm22 56H27V68h13v10zm-3-25V36c0-2 2-3 4-2l12 8c2 1 2 4 0 5l-12 8c-2 1-4 0-4-2zm25 
  25H49V68h13v10zm0-56H49V12h13v10zm18 56h-9V68h9v10zm0-56h-9V12h9v10z"/>`.trim();

    const svgInfo =
      `<path d="M30 0C13.3 0 0 13.3 0 30s13.3 30 30 30 30-13.3 30-30S46.7 0 30 0zm6.2 46.6c-1.5.5-2.6 
  1-3.6 1.3a10.9 10.9 0 0 1-3.3.5c-1.7 0-3.3-.5-4.3-1.4a4.68 4.68 0 0 1-1.6-3.6c0-.4.2-1 .2-1.5a20.9 20.9 90 0 1 
  .3-2l2-6.8c.1-.7.3-1.3.4-1.9a8.2 8.2 90 0 0 .3-1.6c0-.8-.3-1.4-.7-1.8s-1-.5-2-.5a4.53 4.53 0 0 0-1.6.3c-.5.2-1 
  .2-1.3.4l.6-2.1c1.2-.5 2.4-1 3.5-1.3s2.3-.6 3.3-.6c1.9 0 3.3.6 4.3 1.3s1.5 2.1 1.5 3.5c0 .3 0 .9-.1 1.6a10.4 10.4 
  90 0 1-.4 2.2l-1.9 6.7c-.2.5-.2 1.1-.4 1.8s-.2 1.3-.2 1.6c0 .9.2 1.6.6 1.9s1.1.5 2.1.5a6.1 6.1 90 0 0 1.5-.3 9 9 90 
  0 0 1.4-.4l-.6 2.2zm-3.8-35.2a1 1 0 010 8.6 1 1 0 010-8.6z"/>`.trim();

    const svgPlayList =
      `<path d="M0 3h12v2H0zm0 4h12v2H0zm0 4h8v2H0zm16 0V7h-2v4h-4v2h4v4h2v-4h4v-2z"/>`.trim();

    // eslint-disable-next-line no-unused-vars
    const svgDiag1 = `<svg stroke="currentColor" fill="none"><path d="M8 2h2v2M7 5l3-3m-6 8H2V8m0 2l3-3"/></svg>`;
    // eslint-disable-next-line no-unused-vars
    const svgDiag2 = `<svg stroke="currentColor" fill="none"><path d="M7 3v2h2M7 5l3-3M5 9V7H3m-1 3l3-3"/></svg>`;

    /**
     * Get GMT offset for the current timezone
     * @returns {string} GMT offset string (e.g., "+9" or "-5")
     */
    // eslint-disable-next-line no-unused-vars
    const getGMT = () => {
      const m = new Date('2023-01-01T00:00:00Z');
      return m.getDate() === 1 ? `+${m.getHours()}` : `-${24 - m.getHours()}`;
    };

    /**
     * Get localized word based on current page language
     * @param {string} tag - Word identifier
     * @returns {string} Localized word or empty string
     */
    function getWord(tag) {
      return langWords[pageLang]?.[tag] || langWords['en']?.[tag] || '';
    }

    /**
     * Create SVG element string
     * @param {number} w - Width
     * @param {number} h - Height
     * @param {number} vw - ViewBox width
     * @param {number} vh - ViewBox height
     * @param {string} p - Path data
     * @param {string} m - Optional class name
     * @returns {string} SVG element string
     */
    const svgElm = (w, h, vw, vh, p, m) =>
      `<svg${m ? ` class=${m}` : ''} width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;

    const hiddenTabsByUserCSS = 0;

    /**
     * Generate HTML for tab buttons
     * @returns {string} HTML string for tabs
     */

    function getTabsHTML() {
      const sTabBtnVideos = `${svgElm(16, 16, 90, 90, svgVideos)}<span>${getWord('videos')}</span>`;
      const sTabBtnInfo = `${svgElm(16, 16, 60, 60, svgInfo)}<span>${getWord('info')}</span>`;
      const sTabBtnPlayList = `${svgElm(16, 16, 20, 20, svgPlayList)}<span>${getWord('playlist')}</span>`;

      const str1 = `
        <paper-ripple class="style-scope yt-icon-button">
            <div id="background" class="style-scope paper-ripple" style="opacity:0;"></div>
            <div id="waves" class="style-scope paper-ripple"></div>
        </paper-ripple>
        `;

      const str_fbtns = `
    <div class="font-size-right">
    <div class="font-size-btn font-size-plus" tyt-di="8rdLQ">
    <svg width="12" height="12" viewbox="0 0 50 50" preserveAspectRatio="xMidYMid meet" 
    stroke="currentColor" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-size">
      <path d="M12 25H38M25 12V38"/>
    </svg>
    </div><div class="font-size-btn font-size-minus" tyt-di="8rdLQ">
    <svg width="12" height="12" viewbox="0 0 50 50" preserveAspectRatio="xMidYMid meet"
    stroke="currentColor" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-size">
      <path d="M12 25h26"/>
    </svg>
    </div>
    </div>
    `.replace(/[\r\n]+/g, '');

      const str_tabs = [
        `<a id="tab-btn1" tyt-di="q9Kjc" tyt-tab-content="#tab-info" class="tab-btn${(hiddenTabsByUserCSS & 1) === 1 ? ' tab-btn-hidden' : ''}">${sTabBtnInfo}${str1}${str_fbtns}</a>`,
        `<a id="tab-btn3" tyt-di="q9Kjc" tyt-tab-content="#tab-comments" class="tab-btn${(hiddenTabsByUserCSS & 2) === 2 ? ' tab-btn-hidden' : ''}">${svgElm(16, 16, 120, 120, svgComments)}<span id="tyt-cm-count"></span>${str1}${str_fbtns}</a>`,
        `<a id="tab-btn4" tyt-di="q9Kjc" tyt-tab-content="#tab-videos" class="tab-btn${(hiddenTabsByUserCSS & 4) === 4 ? ' tab-btn-hidden' : ''}">${sTabBtnVideos}${str1}${str_fbtns}</a>`,
        `<a id="tab-btn5" tyt-di="q9Kjc" tyt-tab-content="#tab-list" class="tab-btn tab-btn-hidden">${sTabBtnPlayList}${str1}${str_fbtns}</a>`,
      ].join('');

      const addHTML = `
        <div id="right-tabs">
            <tabview-view-pos-thead></tabview-view-pos-thead>
            <header>
                <div id="material-tabs">
                    ${str_tabs}
                </div>
            </header>
            <div class="tab-content">
                <div id="tab-info" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-comments" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-videos" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
                <div id="tab-list" class="tab-content-cld tab-content-hidden" tyt-hidden userscript-scrollbar-render></div>
            </div>
        </div>
        `;
      return addHTML;
    }

    function getLang() {
      const htmlLang = ((document || 0).documentElement || 0).lang || '';

      // Language mapping with optimized lookup
      const langMap = {
        en: 'en',
        'en-GB': 'en',
        de: 'du',
        'de-DE': 'du',
        fr: 'fr',
        'fr-CA': 'fr',
        'fr-FR': 'fr',
        'zh-Hant': 'tw',
        'zh-Hant-HK': 'tw',
        'zh-Hant-TW': 'tw',
        'zh-Hans': 'cn',
        'zh-Hans-CN': 'cn',
        ja: 'jp',
        'ja-JP': 'jp',
        ko: 'kr',
        'ko-KR': 'kr',
        ru: 'ru',
        'ru-RU': 'ru',
      };

      return langMap[htmlLang] || 'en';
    }

    function getLangForPage() {
      const lang = getLang();
      pageLang = langWords[lang] ? lang : 'en';
    }

    /** @type {Object.<string, number>} */
    const _locks = {};

    const lockGet = new Proxy(_locks, {
      get(target, prop) {
        return target[prop] || 0;
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    const lockSet = new Proxy(_locks, {
      get(target, prop) {
        if (target[prop] > MAX_ATTRIBUTE_VALUE) target[prop] = ATTRIBUTE_RESET_VALUE;
        return (target[prop] = (target[prop] || 0) + 1);
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    // note: xxxxxxxxxAsyncLock is not expected for calling multiple time in a short period.
    //       it is just to split the process into microTasks.

    const videosElementProvidedPromise = new PromiseExternal();
    const navigateFinishedPromise = new PromiseExternal();

    let isRightTabsInserted = false;
    const rightTabsProvidedPromise = new PromiseExternal();

    const infoExpanderElementProvidedPromise = new PromiseExternal();

    const pluginsDetected = {};
    const pluginDetectObserver = new MutationObserver(mutations => {
      let changeOnRoot = false;
      const newPlugins = [];
      const attributeChangedSet = new Set();
      for (const mutation of mutations) {
        if (mutation.target === document) changeOnRoot = true;
        let detected = '';
        switch (mutation.attributeName) {
          case 'data-ytlstm-new-layout':
          case 'data-ytlstm-overlay-text-shadow':
          case 'data-ytlstm-theater-mode':
            detected = 'external.ytlstm'; // YouTube Livestreams Theater Mode
            attributeChangedSet.add(detected);
            break;
        }
        if (detected && !pluginsDetected[detected]) {
          pluginsDetected[detected] = true;
          newPlugins.push(detected);
        }
      }
      if (elements.flexy && attributeChangedSet.has('external.ytlstm')) {
        elements.flexy.setAttribute(
          'tyt-external-ytlstm',
          document.querySelector('[data-ytlstm-theater-mode]') ? '1' : '0'
        );
      }
      if (changeOnRoot) {
        // prevent change of document.body
        pluginDetectObserver.observe(document.body, { attributes: true });
      }
      for (const detected of newPlugins) {
        const pluginItem = plugin[`${detected}`];
        if (pluginItem) {
          pluginItem.activate();
        } else {
          console.warn(`No Plugin Activator for ${detected}`);
        }
      }
    });

    pluginDetectObserver.observe(document.documentElement, { attributes: true });
    if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
    navigateFinishedPromise.then(() => {
      pluginDetectObserver.observe(document.documentElement, { attributes: true });
      if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
    });

    /**
     * Function to calculate if element can collapse
     * @param {*} _s - Parameter (unused but kept for compatibility)
     */
    const funcCanCollapse = function (_s) {
      const playlistElm = elements.playlist;
      const ytdFlexyElm = elements.flexy;
      // console.log(1882, chatElm, ytdFlexyElm)
      let doAttributeChange = 0;
      if (playlistElm && ytdFlexyElm) {
        if (playlistElm.closest('[hidden]')) {
          doAttributeChange = 2;
        } else if (playlistElm.hasAttribute000('collapsed')) {
          doAttributeChange = 2;
        } else {
          doAttributeChange = 1;
        }
      } else if (ytdFlexyElm) {
        doAttributeChange = 2;
      }
      if (doAttributeChange === 1) {
        if (ytdFlexyElm.getAttribute000('tyt-playlist-expanded') !== '') {
          ytdFlexyElm.setAttribute111('tyt-playlist-expanded', '');
        }
      } else if (doAttributeChange === 2) {
        if (ytdFlexyElm.hasAttribute000('tyt-playlist-expanded')) {
          ytdFlexyElm.removeAttribute000('tyt-playlist-expanded');
        }
      }
    };

    const aoChatAttrChangeFn = async lockId => {
      if (lockGet['aoChatAttrAsyncLock'] !== lockId) return;

      const chatElm = elements.chat;
      const ytdFlexyElm = elements.flexy;
      if (chatElm && ytdFlexyElm) {
        const isChatCollapsed = chatElm.hasAttribute000('collapsed');
        if (isChatCollapsed) {
          ytdFlexyElm.setAttribute111('tyt-chat-collapsed', '');
        } else {
          ytdFlexyElm.removeAttribute000('tyt-chat-collapsed');
        }

        ytdFlexyElm.setAttribute111('tyt-chat', isChatCollapsed ? '-' : '+');
      }
    };

    const aoPlayListAttrChangeFn = async lockId => {
      if (lockGet['aoPlayListAttrAsyncLock'] !== lockId) return;

      const playlistElm = elements.playlist;
      const ytdFlexyElm = elements.flexy;
      if (playlistElm && ytdFlexyElm) {
        if (playlistElm.hasAttribute000('collapsed')) {
          ytdFlexyElm.removeAttribute000('tyt-playlist-expanded');
        } else {
          ytdFlexyElm.setAttribute111('tyt-playlist-expanded', '');
        }
      } else if (ytdFlexyElm) {
        ytdFlexyElm.removeAttribute000('tyt-playlist-expanded');
      }
    };

    const aoChat = new MutationObserver(() => {
      Promise.resolve(lockSet['aoChatAttrAsyncLock'])
        .then(aoChatAttrChangeFn)
        .catch(err => handlePromiseError(err, 'aoChatAttrChange'));
    });

    const aoPlayList = new MutationObserver(() => {
      Promise.resolve(lockSet['aoPlayListAttrAsyncLock'])
        .then(aoPlayListAttrChangeFn)
        .catch(err => handlePromiseError(err, 'aoPlayListAttrChange'));
    });

    const aoComment = new MutationObserver(async mutations => {
      const commentsArea = elements.comments;
      const ytdFlexyElm = elements.flexy;

      //tyt-comments-video-id //tyt-comments-data-status // hidden
      if (!commentsArea) return;
      let bfHidden = false;
      let bfCommentsVideoId = false;
      let bfCommentDisabled = false;
      for (const mutation of mutations) {
        if (mutation.attributeName === 'hidden' && mutation.target === commentsArea) {
          bfHidden = true;
        } else if (
          mutation.attributeName === 'tyt-comments-video-id' &&
          mutation.target === commentsArea
        ) {
          bfCommentsVideoId = true;
        } else if (
          mutation.attributeName === 'tyt-comments-data-status' &&
          mutation.target === commentsArea
        ) {
          bfCommentDisabled = true;
        }
      }

      if (bfHidden) {
        if (!commentsArea.hasAttribute000('hidden')) {
          Promise.resolve(commentsArea)
            .then(eventMap['settingCommentsVideoId'])
            .catch(err => handlePromiseError(err, 'settingCommentsVideoId'));
        }

        Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
          .then(removeKeepCommentsScroller)
          .catch(err => handlePromiseError(err, 'removeKeepCommentsScroller'));
      }

      if ((bfHidden || bfCommentsVideoId || bfCommentDisabled) && ytdFlexyElm) {
        const commentsDataStatus = +commentsArea.getAttribute000('tyt-comments-data-status');
        if (commentsDataStatus === 2) {
          ytdFlexyElm.setAttribute111('tyt-comment-disabled', '');
        } else if (commentsDataStatus === 1) {
          ytdFlexyElm.removeAttribute000('tyt-comment-disabled');
        }

        Promise.resolve(lockSet['checkCommentsShouldBeHiddenLock'])
          .then(eventMap['checkCommentsShouldBeHidden'])
          .catch(err => handlePromiseError(err, 'checkCommentsShouldBeHidden'));

        const lockId = lockSet['rightTabReadyLock01'];
        await rightTabsProvidedPromise.then();
        if (lockGet['rightTabReadyLock01'] !== lockId) return;

        if (elements.comments !== commentsArea) return;
        if (commentsArea.isConnected === false) return;
        // console.log(7932, 'comments');

        if (commentsArea.closest('#tab-comments')) {
          const shouldTabVisible = !commentsArea.closest('[hidden]');
          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);
        }
      }
    });

    const ioComment = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const target = entry.target;
          const cnt = insp(target);
          if (
            entry.isIntersecting &&
            target instanceof HTMLElement_ &&
            typeof cnt.calculateCanCollapse === 'function'
          ) {
            lockSet['removeKeepCommentsScrollerLock'];
            cnt.calculateCanCollapse(true);
            target.setAttribute111('io-intersected', '');
            const ytdFlexyElm = elements.flexy;
            if (ytdFlexyElm && !ytdFlexyElm.hasAttribute000('keep-comments-scroller')) {
              ytdFlexyElm.setAttribute111('keep-comments-scroller', '');
            }
          } else if (target.hasAttribute000('io-intersected')) {
            target.removeAttribute000('io-intersected');
          }
        }
      },
      {
        threshold: [0],
        rootMargin: '32px', // enlarging viewport for getting intersection earlier
      }
    );

    let bFixForResizedTabLater = false;
    let lastRoRightTabsWidth = 0;

    const roRightTabs = new ResizeObserver(entries => {
      const entry = entries[entries.length - 1];
      const width = Math.round(entry.borderBoxSize.inlineSize);

      if (lastRoRightTabsWidth !== width) {
        lastRoRightTabsWidth = width;
        if ((tabAStatus & 2) === 2) {
          bFixForResizedTabLater = false;
          Promise.resolve(1).then(eventMap['fixForTabDisplay']);
        } else {
          bFixForResizedTabLater = true;
        }
      }
    });

    /**
     * Switch to specified tab
     * @param {string|Element} activeLink - Tab link selector or element
     */
    const switchToTab = activeLink => {
      if (typeof activeLink === 'string') {
        activeLink = document.querySelector(`a[tyt-tab-content="${activeLink}"]`) || null;
      }

      const ytdFlexyElm = elements.flexy;
      const links = document.querySelectorAll('#material-tabs a[tyt-tab-content]');

      for (const link of links) {
        const content = document.querySelector(link.getAttribute000('tyt-tab-content'));
        if (!link || !content) continue;

        const isActive = link === activeLink;

        link.classList.toggle('active', isActive);
        content.classList.toggle('tab-content-hidden', !isActive);

        if (isActive) {
          content.removeAttribute000('tyt-hidden');
        } else if (!content.hasAttribute000('tyt-hidden')) {
          content.setAttribute111('tyt-hidden', '');
        }
      }

      const switchingTo = activeLink ? activeLink.getAttribute000('tyt-tab-content') : '';
      if (switchingTo) {
        lastTab = lastPanel = switchingTo;
      }

      if (ytdFlexyElm?.getAttribute000('tyt-chat') === '') {
        ytdFlexyElm.removeAttribute000('tyt-chat');
      }
      ytdFlexyElm?.setAttribute111('tyt-tab', switchingTo);

      if (switchingTo) {
        bFixForResizedTabLater = false;
        Promise.resolve(0).then(eventMap['fixForTabDisplay']);
      }
    };

    let tabAStatus = 0;

    /**
     * Calculate status flags based on element attributes
     * @param {number} r - Initial result value
     * @param {number} flag - Flags to check (bitwise)
     * @returns {number} Calculated status flags
     */
    const calculationFn = (r = 0, flag) => {
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return r;
      if (flag & 1) {
        r |= 1;
        if (!ytdFlexyElm.hasAttribute000('theater')) r -= 1;
      }
      if (flag & 2) {
        r |= 2;
        if (!ytdFlexyElm.getAttribute000('tyt-tab')) r -= 2;
      }
      if (flag & 4) {
        r |= 4;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '-') r -= 4;
      }
      if (flag & 8) {
        r |= 8;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '+') r -= 8;
      }
      if (flag & 16) {
        r |= 16;
        if (!ytdFlexyElm.hasAttribute000('is-two-columns_')) r -= 16;
      }
      if (flag & 32) {
        r |= 32;
        if (!ytdFlexyElm.hasAttribute000('tyt-egm-panel_')) r -= 32;
      }
      if (flag & 64) {
        r |= 64;
        if (!document.fullscreenElement) r -= 64;
      }

      if (flag & 128) {
        r |= 128;
        if (!ytdFlexyElm.hasAttribute000('tyt-playlist-expanded')) r -= 128;
      }
      if (flag & 4096) {
        r |= 4096;
        if (ytdFlexyElm.getAttribute('tyt-external-ytlstm') !== '1') r -= 4096;
      }
      return r;
    };

    /**
     * Check if theater mode is active
     * @returns {boolean} True if theater mode is active
     */
    function isTheater() {
      return Boolean(elements.flexy?.hasAttribute000('theater'));
    }

    /**
     * Get theater mode toggle button
     * @returns {HTMLButtonElement|null} Theater button or null
     */
    function getTheaterButton() {
      return document.querySelector('ytd-watch-flexy #ytd-player button.ytp-size-button');
    }

    /**
     * Enable theater mode
     * @internal Reserved for future use
     */
    // eslint-disable-next-line no-unused-vars
    function ytBtnSetTheater() {
      if (!isTheater()) {
        getTheaterButton()?.click();
      }
    }

    /**
     * Disable theater mode
     */
    function ytBtnCancelTheater() {
      if (isTheater()) {
        getTheaterButton()?.click();
      }
    }

    /**
     * Get element with most nested children (best match)
     * @param {string} selector - CSS selector
     * @returns {Element|null} Element with most children or null
     */
    function getSuitableElement(selector) {
      const elements = document.querySelectorAll(selector);
      let bestIndex = -1;
      let maxDepth = -1;

      for (let i = 0; i < elements.length; i++) {
        const depth = elements[i].getElementsByTagName('*').length;
        if (depth > maxDepth) {
          maxDepth = depth;
          bestIndex = i;
        }
      }

      return bestIndex >= 0 ? elements[bestIndex] : null;
    }

    /**
     * Expand YouTube live chat
     */
    function ytBtnExpandChat() {
      const dom = getSuitableElement('ytd-live-chat-frame#chat');
      const cnt = insp(dom);

      if (cnt && typeof cnt.collapsed === 'boolean') {
        if (typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: {
              collapsed: false,
            },
          });
          if (cnt.collapsed === false) return;
        }
        cnt.collapsed = false;
        if (cnt.collapsed === false) return;
        if (cnt.isHiddenByUser === true && cnt.collapsed === true) {
          cnt.isHiddenByUser = false;
          cnt.collapsed = false;
        }
      }

      let button = document.querySelector(
        'ytd-live-chat-frame#chat[collapsed] > .ytd-live-chat-frame#show-hide-button'
      );
      if (button) {
        button =
          button.querySelector000('div.yt-spec-touch-feedback-shape') ||
          button.querySelector000('ytd-toggle-button-renderer');
        button?.click();
      }
    }

    /**
     * Collapse YouTube live chat
     */
    /**
     * Collapse YouTube live chat panel
     */
    function ytBtnCollapseChat() {
      const dom = getSuitableElement('ytd-live-chat-frame#chat');
      const cnt = insp(dom);

      if (cnt && typeof cnt.collapsed === 'boolean') {
        if (typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: {
              collapsed: true,
            },
          });
          if (cnt.collapsed === true) return;
        }
        cnt.collapsed = true;
        if (cnt.collapsed === true) return;
        if (cnt.isHiddenByUser === false && cnt.collapsed === false) {
          cnt.isHiddenByUser = true;
          cnt.collapsed = true;
        }
      }

      let button = document.querySelector(
        'ytd-live-chat-frame#chat:not([collapsed]) > .ytd-live-chat-frame#show-hide-button'
      );
      if (button) {
        button =
          button.querySelector000('div.yt-spec-touch-feedback-shape') ||
          button.querySelector000('ytd-toggle-button-renderer');
        button?.click();
      }
    }

    /**
     * Control YouTube engagement panels (show/hide)
     * @param {Array|Object} arr - Array of panel actions or single action object
     */
    function ytBtnEgmPanelCore(arr) {
      if (!arr) return;
      if (!('length' in arr)) arr = [arr];

      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;

      const actions = [];

      for (const entry of arr) {
        if (!entry) continue;

        const { panelId, toHide, toShow } = entry;

        if (toHide === true && !toShow) {
          actions.push({
            changeEngagementPanelVisibilityAction: {
              targetId: panelId,
              visibility: 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN',
            },
          });
        } else if (toShow === true && !toHide) {
          actions.push({
            showEngagementPanelEndpoint: {
              panelIdentifier: panelId,
            },
          });
        }
      }

      if (actions.length > 0) {
        const cnt = insp(ytdFlexyElm);
        cnt.resolveCommand(
          {
            signalServiceEndpoint: {
              signal: 'CLIENT_SIGNAL',
              actions: actions,
            },
          },
          {},
          false
        );
      }
    }

    /*
            function ytBtnCloseEngagementPanel( s) {
              //ePanel.setAttribute('visibility',"ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
           
              let panelId = s.getAttribute('target-id')
              scriptletDeferred.debounce(() => {
                document.dispatchEvent(new CustomEvent('tyt-engagement-panel-visibility-change', {
                  detail: {
                    panelId,
                    toHide: true
                  }
                }))
              })
           
            }
        
            /**
             * Close all expanded YouTube engagement panels
             */
    function ytBtnCloseEngagementPanels() {
      const actions = [];
      for (const panelElm of document.querySelectorAll(
        `ytd-watch-flexy[tyt-tab] #panels.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility]:not([hidden])`
      )) {
        if (
          panelElm.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          actions.push({
            panelId: panelElm.getAttribute000('target-id'),
            toHide: true,
          });
        }
      }
      ytBtnEgmPanelCore(actions);
    }

    /**
     * Open YouTube playlist panel
     */
    function ytBtnOpenPlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = false;
      }
    }

    /**
     * Close YouTube playlist panel
     */
    function ytBtnClosePlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = true;
      }
    }

    const updateChatLocation498 = function () {
      if (this.is !== 'ytd-watch-grid') {
        this.updatePageMediaQueries();
        this.schedulePlayerSizeUpdate_();
      }
    };

    const mirrorNodeWS = new WeakMap();

    const dummyNode = document.createElement('noscript');

    const __j4836__ = Symbol();
    const __j5744__ = Symbol(); // original element
    const __j5733__ = Symbol(); // __lastChanged__

    const monitorDataChangedByDOMMutation = async function (_mutations) {
      const nodeWR = this;
      const node = kRef(nodeWR);
      if (!node) return;

      const cnt = insp(node);
      const __lastChanged__ = cnt[__j5733__];

      const val = cnt.data ? cnt.data[__j4836__] || 1 : 0;

      if (__lastChanged__ !== val) {
        cnt[__j5733__] = val > 0 ? (cnt.data[__j4836__] = Date.now()) : 0;

        await Promise.resolve(); // required for making sufficient delay for data rendering
        attributeInc(node, 'tyt-data-change-counter'); // next macro task
      }
    };

    const moChangeReflection = function (mutations) {
      const nodeWR = this;
      const node = kRef(nodeWR);
      if (!node) return;
      const originElement = kRef(node[__j5744__] || null) || null;
      if (!originElement) return;

      const cnt = insp(node);
      const oriCnt = insp(originElement);

      if (mutations) {
        let bfDataChangeCounter = false;
        for (const mutation of mutations) {
          if (
            mutation.attributeName === 'tyt-clone-refresh-count' &&
            mutation.target === originElement
          ) {
            bfDataChangeCounter = true;
          } else if (
            mutation.attributeName === 'tyt-data-change-counter' &&
            mutation.target === originElement
          ) {
            bfDataChangeCounter = true;
          }
        }
        if (bfDataChangeCounter && oriCnt.data) {
          node.replaceWith(dummyNode);
          cnt.data = Object.assign({}, oriCnt.data);
          dummyNode.replaceWith(node);
        }
      }
    };

    /**
     * Increment attribute value with overflow protection
     * @param {Element} elm - Element to modify
     * @param {string} prop - Attribute name
     * @returns {number} New attribute value
     */
    const attributeInc = (elm, prop) => {
      let v = (+elm.getAttribute000(prop) || 0) + 1;
      if (v > MAX_ATTRIBUTE_VALUE) v = ATTRIBUTE_RESET_VALUE;
      elm.setAttribute000(prop, v);
      return v;
    };

    /**
     * Validates if a string is a valid YouTube channel ID
     * Format: UC[-_a-zA-Z0-9+=.]{22}
     * @see https://support.google.com/youtube/answer/6070344?hl=en
     * @param {string} x - The string to validate
     * @returns {boolean} True if valid channel ID
     */
    const isChannelId = x => {
      return typeof x === 'string' && x.length === 24 && /^UC[-_a-zA-Z0-9+=.]{22}$/.test(x);
    };

    /**
     * Fix and organize info panel layout
     * @param {number|null} lockId - Lock identifier for concurrent execution control
     */
    const infoFix = lockId => {
      if (lockId !== null && lockGet['infoFixLock'] !== lockId) return;
      const infoExpander = elements.infoExpander;
      const infoContainer =
        (infoExpander ? infoExpander.parentNode : null) || document.querySelector('#tab-info');
      const ytdFlexyElm = elements.flexy;
      if (!infoContainer || !ytdFlexyElm) return;
      if (infoExpander) {
        const match =
          infoExpander.matches('#tab-info > [class]') ||
          infoExpander.matches('#tab-info > [tyt-main-info]');
        if (!match) return;
      }

      const requireElements = [
        ...document.querySelectorAll(
          'ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"] > *, ytd-watch-metadata.ytd-watch-flexy #extra-content > *'
        ),
      ]
        .filter(elm => {
          return typeof elm.is == 'string';
        })
        .map(elm => {
          const is = elm.is;
          while (elm instanceof HTMLElement_) {
            const q = [...elm.querySelectorAll(is)].filter(e => insp(e).data);
            if (q.length >= 1) return q[0];
            elm = elm.parentNode;
          }
        })
        .filter(elm => !!elm && typeof elm.is === 'string');

      const source = requireElements.map(entry => {
        const inst = insp(entry);
        return {
          data: inst.data,
          tag: inst.is,
          elm: entry,
        };
      });

      let noscript_ = document.querySelector('noscript#aythl');
      if (!noscript_) {
        noscript_ = document.createElement('noscript');
        noscript_.id = 'aythl';

        inPageRearrange = true;
        ytdFlexyElm.insertBefore000(noscript_, ytdFlexyElm.firstChild);
        inPageRearrange = false;
      }
      const noscript = noscript_;

      let requiredUpdate = false;
      const mirrorElmSet = new Set();
      const targetParent = infoContainer;
      for (const { data, tag: tag, elm: s } of source) {
        let mirrorNode = mirrorNodeWS.get(s);
        mirrorNode = mirrorNode ? kRef(mirrorNode) : mirrorNode;
        if (!mirrorNode) {
          const cnt = insp(s);
          const cProto = cnt.constructor.prototype;

          const element = document.createElement(tag);
          noscript.appendChild(element);
          mirrorNode = element;
          mirrorNode[__j5744__] = mWeakRef(s);

          const nodeWR = mWeakRef(mirrorNode);

          new MutationObserver(moChangeReflection.bind(nodeWR)).observe(s, {
            attributes: true,
            attributeFilter: ['tyt-clone-refresh-count', 'tyt-data-change-counter'],
          });

          s.jy8432 = 1;
          if (
            !(cProto instanceof Node) &&
            !cProto._dataChanged496 &&
            typeof cProto._createPropertyObserver === 'function'
          ) {
            cProto._dataChanged496 = function () {
              const cnt = this;
              const node = cnt.hostElement || cnt;
              if (node.jy8432) {
                attributeInc(node, 'tyt-data-change-counter');
              }
            };
            cProto._createPropertyObserver('data', '_dataChanged496', undefined);
          } else if (
            !(cProto instanceof Node) &&
            !cProto._dataChanged496 &&
            cProto.useSignals === true &&
            insp(s).signalProxy
          ) {
            const dataSignal = cnt?.signalProxy?.signalCache?.data;
            if (
              dataSignal &&
              typeof dataSignal.setWithPath === 'function' &&
              !dataSignal.setWithPath573 &&
              !dataSignal.controller573
            ) {
              dataSignal.controller573 = mWeakRef(cnt);
              dataSignal.setWithPath573 = dataSignal.setWithPath;
              dataSignal.setWithPath = function () {
                const cnt = kRef(this.controller573 || null) || null;
                cnt &&
                  typeof cnt._dataChanged496k === 'function' &&
                  Promise.resolve(cnt)
                    .then(cnt._dataChanged496k)
                    .catch(err => handlePromiseError(err, 'setWithPath_dataChanged496k'));
                return this.setWithPath573(...arguments);
              };
              cProto._dataChanged496 = function () {
                const cnt = this;
                const node = cnt.hostElement || cnt;
                if (node.jy8432) {
                  attributeInc(node, 'tyt-data-change-counter');
                }
              };
              cProto._dataChanged496k = cnt => cnt._dataChanged496();
            }
          }

          if (!cProto._dataChanged496) {
            new MutationObserver(
              monitorDataChangedByDOMMutation.bind(mirrorNode[__j5744__])
            ).observe(s, { attributes: true, childList: true, subtree: true });
          }

          mirrorNodeWS.set(s, nodeWR);
          requiredUpdate = true;
        } else {
          if (mirrorNode.parentNode !== targetParent) {
            requiredUpdate = true;
          }
        }
        if (!requiredUpdate) {
          const cloneNodeCnt = insp(mirrorNode);
          if (cloneNodeCnt.data !== data) {
            // if(mirrorNode.parentNode !== noscript){
            //   noscript.appendChild(mirrorNode);
            // }
            // mirrorNode.replaceWith(dummyNode);
            // cloneNodeCnt.data = data;
            // dummyNode.replaceWith(mirrorNode);
            requiredUpdate = true;
          }
        }

        mirrorElmSet.add(mirrorNode);
        source.mirrored = mirrorNode;
      }

      const mirroElmArr = [...mirrorElmSet];
      mirrorElmSet.clear();

      if (!requiredUpdate) {
        let e = infoExpander ? -1 : 0;
        // DOM Tree Check
        for (let n = targetParent.firstChild; n instanceof Node; n = n.nextSibling) {
          const target = e < 0 ? infoExpander : mirroElmArr[e];
          e++;
          if (n !== target) {
            // target can be undefined if index overflow
            requiredUpdate = true;
            break;
          }
        }
        if (!requiredUpdate && e !== mirroElmArr.length + 1) requiredUpdate = true;
      }

      if (requiredUpdate) {
        if (infoExpander) {
          targetParent.assignChildren111(null, infoExpander, mirroElmArr);
        } else {
          targetParent.replaceChildren000(...mirroElmArr);
        }
        for (const mirrorElm of mirroElmArr) {
          // trigger data assignment and record refresh count by manual update
          const j = attributeInc(mirrorElm, 'tyt-clone-refresh-count');
          const oriElm = kRef(mirrorElm[__j5744__] || null) || null;
          if (oriElm) {
            oriElm.setAttribute111('tyt-clone-refresh-count', j);
          }
        }
      }

      mirroElmArr.length = 0;
      source.length = 0;
    };

    /**
     * Fix and optimize secondary layout structure
     * @param {number} lockId - Lock identifier for concurrent execution control
     */
    const layoutFix = lockId => {
      if (lockGet['layoutFixLock'] !== lockId) return;
      // console.log('((layoutFix))')

      const secondaryWrapper = document.querySelector(
        '#secondary-inner.style-scope.ytd-watch-flexy > secondary-wrapper'
      );
      // console.log(3838, !!chatContainer, !!(secondaryWrapper && secondaryInner), secondaryInner?.firstChild, secondaryInner?.lastChild , secondaryWrapper?.parentNode === secondaryInner)
      if (secondaryWrapper) {
        const secondaryInner = secondaryWrapper.parentNode;

        const chatContainer = document.querySelector(
          '#columns.style-scope.ytd-watch-flexy [tyt-chat-container]'
        );
        if (
          secondaryInner.firstChild !== secondaryInner.lastChild ||
          (chatContainer && !chatContainer.closest('secondary-wrapper'))
        ) {
          // console.log(38381)
          const w = [];
          const w2 = [];
          for (
            let node = secondaryInner.firstChild;
            node instanceof Node;
            node = node.nextSibling
          ) {
            if (node === chatContainer && chatContainer) {
            } else if (node === secondaryWrapper) {
              for (
                let node2 = secondaryWrapper.firstChild;
                node2 instanceof Node;
                node2 = node2.nextSibling
              ) {
                if (node2 === chatContainer && chatContainer) {
                } else {
                  if (node2.id === 'right-tabs' && chatContainer) {
                    w2.push(chatContainer);
                  }
                  w2.push(node2);
                }
              }
            } else {
              w.push(node);
            }
          }
          // console.log('qww', w, w2)

          inPageRearrange = true;
          secondaryWrapper.replaceChildren000(...w, ...w2);
          inPageRearrange = false;
          const chatElm = elements.chat;
          const chatCnt = insp(chatElm);
          if (
            chatCnt &&
            typeof chatCnt.urlChanged === 'function' &&
            secondaryWrapper.contains(chatElm)
          ) {
            // setTimeout(() => chatCnt.urlChanged, 136);
            if (typeof chatCnt.urlChangedAsync12 === 'function') {
              DEBUG_5085 && console.log('elements.chat urlChangedAsync12', 61);
              chatCnt.urlChanged();
            } else {
              DEBUG_5085 && console.log('elements.chat urlChangedAsync12', 62);
              setTimeout(() => chatCnt.urlChanged(), 136);
            }
          }
        }
      }
    };

    let lastPanel = '';
    let lastTab = '';
    // let fixInitialTabState = 0;

    const aoEgmPanels = new MutationObserver(() => {
      // console.log(5094,3);
      Promise.resolve(lockSet['updateEgmPanelsLock'])
        .then(updateEgmPanels)
        .catch(err => handlePromiseError(err, 'aoEgmPanels_updateEgmPanels'));
    });

    const removeKeepCommentsScroller = async lockId => {
      if (lockGet['removeKeepCommentsScrollerLock'] !== lockId) return;
      await Promise.resolve();
      if (lockGet['removeKeepCommentsScrollerLock'] !== lockId) return;
      const ytdFlexyFlm = elements.flexy;
      if (ytdFlexyFlm) {
        ytdFlexyFlm.removeAttribute000('keep-comments-scroller');
      }
    };

    const updateEgmPanels = async lockId => {
      if (lockId !== lockGet['updateEgmPanelsLock']) return;
      await navigateFinishedPromise.then().catch(console.warn);
      if (lockId !== lockGet['updateEgmPanelsLock']) return;
      // console.log('updateEgmPanels::called');
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;
      let newVisiblePanels = [];
      let newHiddenPanels = [];
      let allVisiblePanels = [];
      for (const panelElm of document.querySelectorAll('[tyt-egm-panel][target-id][visibility]')) {
        const visibility = panelElm.getAttribute000('visibility');

        if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' || panelElm.closest('[hidden]')) {
          if (panelElm.hasAttribute000('tyt-visible-at')) {
            panelElm.removeAttribute000('tyt-visible-at');
            newHiddenPanels.push(panelElm);
          }
        } else if (
          visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          const visibleAt = panelElm.getAttribute000('tyt-visible-at');
          if (!visibleAt) {
            panelElm.setAttribute111('tyt-visible-at', Date.now());
            newVisiblePanels.push(panelElm);
          }
          allVisiblePanels.push(panelElm);
        }
      }
      if (newVisiblePanels.length >= 1 && allVisiblePanels.length >= 2) {
        const targetVisible = newVisiblePanels[newVisiblePanels.length - 1];

        const actions = [];
        for (const panelElm of allVisiblePanels) {
          if (panelElm === targetVisible) continue;
          actions.push({
            panelId: panelElm.getAttribute000('target-id'),
            toHide: true,
          });
        }

        if (actions.length >= 1) {
          ytBtnEgmPanelCore(actions);
        }
      }
      if (allVisiblePanels.length >= 1) {
        ytdFlexyElm.setAttribute111('tyt-egm-panel_', '');
      } else {
        ytdFlexyElm.removeAttribute000('tyt-egm-panel_');
      }
      newVisiblePanels.length = 0;
      newVisiblePanels = null;
      newHiddenPanels.length = 0;
      newHiddenPanels = null;
      allVisiblePanels.length = 0;
      allVisiblePanels = null;
    };

    const checkElementExist = (css, exclude) => {
      for (const p of document.querySelectorAll(css)) {
        if (!p.closest(exclude)) return p;
      }
      return null;
    };

    let fixInitialTabStateK = 0;

    const { handleNavigateFactory } = (() => {
      let isLoadStartListened = false;

      function findLcComment(lc) {
        if (arguments.length === 1) {
          const element = document.querySelector(
            `#tab-comments ytd-comments ytd-comment-renderer #header-author a[href*="lc=${lc}"]`
          );
          if (element) {
            const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
            if (commentRendererElm && lc) {
              return {
                lc,
                commentRendererElm,
              };
            }
          }
        } else if (arguments.length === 0) {
          const element = document.querySelector(
            `#tab-comments ytd-comments ytd-comment-renderer > #linked-comment-badge span:not(:empty)`
          );
          if (element) {
            const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
            if (commentRendererElm) {
              const header = _querySelector.call(commentRendererElm, '#header-author');
              if (header) {
                const anchor = _querySelector.call(header, 'a[href*="lc="]');
                if (anchor) {
                  const href = anchor.getAttribute('href') || '';
                  const m = /[&?]lc=([\w_.-]+)/.exec(href); // dot = sub-comment
                  if (m) {
                    lc = m[1];
                  }
                }
              }
            }
            if (commentRendererElm && lc) {
              return {
                lc,
                commentRendererElm,
              };
            }
          }
        }

        return null;
      }

      function lcSwapFuncA(targetLcId, currentLcId) {
        let done = 0;
        try {
          // console.log(currentLcId, targetLcId)

          const r1 = findLcComment(currentLcId).commentRendererElm;
          const r2 = findLcComment(targetLcId).commentRendererElm;

          if (
            typeof insp(r1).data.linkedCommentBadge === 'object' &&
            typeof insp(r2).data.linkedCommentBadge === 'undefined'
          ) {
            const p = Object.assign({}, insp(r1).data.linkedCommentBadge);

            if (((p || 0).metadataBadgeRenderer || 0).trackingParams) {
              delete p.metadataBadgeRenderer.trackingParams;
            }

            const v1 = findContentsRenderer(r1);
            const v2 = findContentsRenderer(r2);

            if (
              v1.parent === v2.parent &&
              (v2.parent.nodeName === 'YTD-COMMENTS' ||
                v2.parent.nodeName === 'YTD-ITEM-SECTION-RENDERER')
            ) {
            } else {
              // currently not supported
              return false;
            }

            if (v2.index >= 0) {
              if (v2.parent.nodeName === 'YTD-COMMENT-REPLIES-RENDERER') {
                if (lcSwapFuncB(targetLcId, currentLcId, p)) {
                  done = 1;
                }

                done = 1;
              } else {
                const v2pCnt = insp(v2.parent);
                const v2Conents = (v2pCnt.data || 0).contents || 0;
                if (!v2Conents) console.warn('v2Conents is not found');

                v2pCnt.data = Object.assign({}, v2pCnt.data, {
                  contents: [].concat(
                    [v2Conents[v2.index]],
                    v2Conents.slice(0, v2.index),
                    v2Conents.slice(v2.index + 1)
                  ),
                });

                if (lcSwapFuncB(targetLcId, currentLcId, p)) {
                  done = 1;
                }
              }
            }
          }
        } catch (e) {
          console.warn(e);
        }
        return done === 1;
      }

      function lcSwapFuncB(targetLcId, currentLcId, _p) {
        let done = 0;
        try {
          const r1 = findLcComment(currentLcId).commentRendererElm;
          const r1cnt = insp(r1);
          const r2 = findLcComment(targetLcId).commentRendererElm;
          const r2cnt = insp(r2);

          const r1d = r1cnt.data;
          const p = Object.assign({}, _p);
          r1d.linkedCommentBadge = null;
          delete r1d.linkedCommentBadge;

          const q = Object.assign({}, r1d);
          q.linkedCommentBadge = null;
          delete q.linkedCommentBadge;

          r1cnt.data = Object.assign({}, q);
          r2cnt.data = Object.assign({}, r2cnt.data, { linkedCommentBadge: p });

          done = 1;
        } catch (e) {
          console.warn(e);
        }
        return done === 1;
      }

      const loadStartFx = async evt => {
        const media = (evt || 0).target || 0;
        if (media.nodeName === 'VIDEO' || media.nodeName === 'AUDIO') {
        } else return;

        const newMedia = media;

        const media1 = common.getMediaElement(0); // document.querySelector('#movie_player video[src]');
        const media2 = common.getMediaElements(2); // document.querySelectorAll('ytd-browse[role="main"] video[src]');

        if (media1 !== null && media2.length > 0) {
          if (newMedia !== media1 && media1.paused === false) {
            if (isVideoPlaying(media1)) {
              Promise.resolve(newMedia)
                .then(video => video.paused === false && video.pause())
                .catch(console.warn);
            }
          } else if (newMedia === media1) {
            for (const s of media2) {
              if (s.paused === false) {
                Promise.resolve(s)
                  .then(s => s.paused === false && s.pause())
                  .catch(console.warn);
                break;
              }
            }
          } else {
            Promise.resolve(media1)
              .then(video1 => video1.paused === false && video1.pause())
              .catch(console.warn);
          }
        }
      };

      const getBrowsableEndPoint = req => {
        let valid = false;
        let endpoint = req ? req.command : null;
        if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.watchEndpoint
        ) {
          const videoId = endpoint.watchEndpoint.videoId;
          const url = endpoint.commandMetadata.webCommandMetadata.url;

          if (typeof videoId === 'string' && typeof url === 'string' && url.indexOf('lc=') > 0) {
            const m = /^\/watch\?v=([\w_-]+)&lc=([\w_.-]+)$/.exec(url); // dot = sub-comment
            if (m && m[1] === videoId) {
              /*
                                          {
                                            "style": "BADGE_STYLE_TYPE_SIMPLE",
                                            "label": "注目のコメント",
                                            "trackingParams": "XXXXXX"
                                        }
                                          */

              const targetLc = findLcComment(m[2]);
              const currentLc = targetLc ? findLcComment() : null;

              if (targetLc && currentLc) {
                const done =
                  targetLc.lc === currentLc.lc ? 1 : lcSwapFuncA(targetLc.lc, currentLc.lc) ? 1 : 0;

                if (done === 1) {
                  common.xReplaceState(history.state, url);
                  return;
                }
              }
            }
          }
        }

        /*
                            
                            {
                              "type": 0,
                              "command": endpoint,
                              "form": {
                                "tempData": {},
                                "reload": false
                              }
                            }
                  
                        */

        if (
          endpoint &&
          (endpoint.commandMetadata || 0).webCommandMetadata &&
          endpoint.browseEndpoint &&
          isChannelId(endpoint.browseEndpoint.browseId)
        ) {
          valid = true;
        } else if (
          endpoint &&
          (endpoint.browseEndpoint || endpoint.searchEndpoint) &&
          !endpoint.urlEndpoint &&
          !endpoint.watchEndpoint
        ) {
          if (endpoint.browseEndpoint && endpoint.browseEndpoint.browseId === 'FEwhat_to_watch') {
            // valid = false;
            const playerMedia = common.getMediaElement(1);
            if (playerMedia && playerMedia.paused === false) valid = true; // home page
          } else if (endpoint.commandMetadata && endpoint.commandMetadata.webCommandMetadata) {
            const meta = endpoint.commandMetadata.webCommandMetadata;
            if (meta && /*meta.apiUrl &&*/ meta.url && meta.webPageType) {
              valid = true;
            }
          }
        }

        if (!valid) endpoint = null;

        return endpoint;
      };

      const shouldUseMiniPlayer = () => {
        const isSubTypeExist = document.querySelector(
          'ytd-page-manager#page-manager > ytd-browse[page-subtype]'
        );

        if (isSubTypeExist) return true;

        const movie_player = [...document.querySelectorAll('#movie_player')].filter(
          e => !e.closest('[hidden]')
        )[0];
        if (movie_player) {
          const media = qsOne(movie_player, 'video[class], audio[class]');
          if (
            media &&
            media.currentTime > 3 &&
            media.duration - media.currentTime > 3 &&
            media.paused === false
          ) {
            return true;
          }
        }
        return false;
        // return true;
        // return !!document.querySelector('ytd-page-manager#page-manager > ytd-browse[page-subtype]');
      };

      const conditionFulfillment = req => {
        const command = req ? req.command : null;
        DEBUG_handleNavigateFactory && console.log('handleNavigateFactory - 0801', command);
        if (!command) return;

        if (command && (command.commandMetadata || 0).webCommandMetadata && command.watchEndpoint) {
        } else if (
          command &&
          (command.commandMetadata || 0).webCommandMetadata &&
          command.browseEndpoint &&
          isChannelId(command.browseEndpoint.browseId)
        ) {
        } else if (
          command &&
          (command.browseEndpoint || command.searchEndpoint) &&
          !command.urlEndpoint &&
          !command.watchEndpoint
        ) {
        } else {
          return false;
        }

        if (!shouldUseMiniPlayer()) return false;

        /*
                          // user would like to switch page immediately without playing the video;
                          // attribute appear after playing video for more than 2s
                          if (!document.head.dataset.viTime) return false;
                          else {
                            let currentVideo = common.getMediaElement(0);
                            if (currentVideo && currentVideo.readyState > currentVideo.HAVE_CURRENT_DATA && currentVideo.currentTime > 2.2 && currentVideo.duration - 2.2 < currentVideo.currentTime) {
                              // disable miniview browsing if the media is near to the end
                              return false;
                            }
                          }
                        */

        if (pageType !== 'watch') return false;

        // 2025.10.16 - ignore ytp-miniplayer-button existance
        // if (!checkElementExist('ytd-watch-flexy #player button.ytp-miniplayer-button.ytp-button', '[hidden]')) {
        //   return false;
        // }

        // DEBUG_handleNavigateFactory && console.log("handleNavigateFactory - 0805");

        return true;
      };

      let u38 = 0;
      const fixChannelAboutPopup = async t38 => {
        let promise = new PromiseExternal();
        const f = () => {
          promise && promise.resolve();
          promise = null;
        };
        document.addEventListener('yt-navigate-finish', f, false);
        await promise.then();
        promise = null;
        document.removeEventListener('yt-navigate-finish', f, false);
        if (t38 !== u38) return;
        setTimeout(() => {
          const currentAbout = [...document.querySelectorAll('ytd-about-channel-renderer')].filter(
            e => !e.closest('[hidden]')
          )[0];
          let okay = false;
          if (!currentAbout) okay = true;
          else {
            const popupContainer = currentAbout.closest('ytd-popup-container');
            if (popupContainer) {
              const cnt = insp(popupContainer);
              let arr = null;
              try {
                arr = cnt.handleGetOpenedPopupsAction_();
              } catch {}
              if (arr && arr.length === 0) okay = true;
            } else {
              okay = false;
            }
          }
          if (okay) {
            const descriptionModel = [
              ...document.querySelectorAll('yt-description-preview-view-model'),
            ].filter(e => !e.closest('[hidden]'))[0];
            if (descriptionModel) {
              const button = [...descriptionModel.querySelectorAll('button')].filter(
                e => !e.closest('[hidden]') && `${e.textContent}`.trim().length > 0
              )[0];
              if (button) {
                button.click();
              }
            }
          }
        }, 80);
      };
      const handleNavigateFactory = handleNavigate => {
        return function (req) {
          if (u38 > MAX_ATTRIBUTE_VALUE) u38 = ATTRIBUTE_RESET_VALUE;
          const t38 = ++u38;

          const $this = this;
          const $arguments = arguments;

          let endpoint = null;

          if (conditionFulfillment(req)) {
            endpoint = getBrowsableEndPoint(req);
          }

          if (!endpoint || !shouldUseMiniPlayer()) return handleNavigate.apply($this, $arguments);

          // console.log('tabview-script-handleNavigate')

          const ytdAppElm = document.querySelector('ytd-app');
          const ytdAppCnt = insp(ytdAppElm);

          let object = null;
          try {
            object = ytdAppCnt.data.response.currentVideoEndpoint.watchEndpoint || null;
          } catch {
            object = null;
          }

          if (typeof object !== 'object') object = null;

          const once = { once: true }; // browsers supporting async function can also use once option.

          if (object !== null && !('playlistId' in object)) {
            let wObject = mWeakRef(object);

            const N = 3;

            let count = 0;

            /*
                                      
                                      rcb(b) => a = playlistId = undefinded
                                      
                                      var scb = function(a, b, c, d) {
                                              a.isInitialized() && (B("kevlar_miniplayer_navigate_to_shorts_killswitch") ? c || d ? ("watch" !== Xu(b) && "shorts" !== Xu(b) && os(a.miniplayerEl, "yt-cache-miniplayer-page-action", [b]),
                                              qs(a.miniplayerEl, "yt-deactivate-miniplayer-action")) : "watch" === Xu(b) && rcb(b) && (qt.getInstance().playlistWatchPageActivation = !0,
                                              a.activateMiniplayer(b)) : c ? ("watch" !== Xu(b) && os(a.miniplayerEl, "yt-cache-miniplayer-page-action", [b]),
                                              qs(a.miniplayerEl, "yt-deactivate-miniplayer-action")) : d ? qs(a.miniplayerEl, "yt-pause-miniplayer-action") : "watch" === Xu(b) && rcb(b) && (qt.getInstance().playlistWatchPageActivation = !0,
                                              a.activateMiniplayer(b)))
                                          };
                            
                                    */

            Object.defineProperty(kRef(wObject) || {}, 'playlistId', {
              get() {
                count++;
                if (count === N) {
                  delete this.playlistId;
                }
                return '*';
              },
              set(value) {
                delete this.playlistId; // remove property definition
                this.playlistId = value; // assign as normal property
              },
              enumerable: false,
              configurable: true,
            });

            let playlistClearout = null;

            let timeoutid = 0;
            Promise.race([
              new Promise(r => {
                timeoutid = setTimeout(r, 4000);
              }),
              new Promise(r => {
                playlistClearout = () => {
                  if (timeoutid > 0) {
                    clearTimeout(timeoutid);
                    timeoutid = 0;
                  }
                  r();
                };
                document.addEventListener('yt-page-type-changed', playlistClearout, once);
              }),
            ])
              .then(() => {
                if (timeoutid !== 0) {
                  playlistClearout &&
                    document.removeEventListener('yt-page-type-changed', playlistClearout, once);
                  timeoutid = 0;
                }
                playlistClearout = null;
                count = N - 1;
                const object = kRef(wObject);
                wObject = null;
                return object ? object.playlistId : null;
              })
              .catch(console.warn);
          }

          if (!isLoadStartListened) {
            isLoadStartListened = true;
            document.addEventListener('loadstart', loadStartFx, true);
          }

          const endpointURL = `${endpoint?.commandMetadata?.webCommandMetadata?.url || ''}`;

          if (
            endpointURL &&
            endpointURL.endsWith('/about') &&
            /\/channel\/UC[-_a-zA-Z0-9+=.]{22}\/about/.test(endpointURL)
          ) {
            fixChannelAboutPopup(t38);
          }

          handleNavigate.apply($this, $arguments);
        };
      };

      return { handleNavigateFactory };
    })();

    const common = (() => {
      let mediaModeLock = 0;
      const _getMediaElement = i => {
        if (mediaModeLock === 0) {
          const e =
            document.querySelector('.video-stream.html5-main-video') ||
            document.querySelector('#movie_player video, #movie_player audio') ||
            document.querySelector('body video[src], body audio[src]');
          if (e) {
            if (e.nodeName === 'VIDEO') mediaModeLock = 1;
            else if (e.nodeName === 'AUDIO') mediaModeLock = 2;
          }
        }
        if (!mediaModeLock) return null;
        if (mediaModeLock === 1) {
          switch (i) {
            case 1:
              return 'ytd-player#ytd-player video[src]';
            case 2:
              return 'ytd-browse[role="main"] video[src]';
            case 0:
            default:
              return '#movie_player video[src]';
          }
        } else if (mediaModeLock === 2) {
          switch (i) {
            case 1:
              return 'ytd-player#ytd-player audio.video-stream.html5-main-video[src]';
            case 2:
              return 'ytd-browse[role="main"] audio.video-stream.html5-main-video[src]';
            case 0:
            default:
              return '#movie_player audio.video-stream.html5-main-video[src]';
          }
        }
        return null;
      };

      return {
        xReplaceState(s, u) {
          try {
            history.replaceState(s, '', u);
          } catch {
            // in case error occurs if replaceState is replaced by any external script / extension
          }
          if (s.endpoint) {
            try {
              const ytdAppElm = document.querySelector('ytd-app');
              const ytdAppCnt = insp(ytdAppElm);
              ytdAppCnt.replaceState(s.endpoint, '', u);
            } catch {}
          }
        },
        getMediaElement(i) {
          const s = _getMediaElement(i) || '';
          if (s) return document.querySelector(s);
          return null;
        },
        getMediaElements(i) {
          const s = _getMediaElement(i) || '';
          if (s) return document.querySelectorAll(s);
          return [];
        },
      };
    })();

    let inPageRearrange = false;
    let tmpLastVideoId = '';
    // const nsMap = new Map();

    const getCurrentVideoId = () => {
      const ytdFlexyElm = elements.flexy;
      const ytdFlexyCnt = insp(ytdFlexyElm);
      if (ytdFlexyCnt && typeof ytdFlexyCnt.videoId === 'string') return ytdFlexyCnt.videoId;
      if (ytdFlexyElm && typeof ytdFlexyElm.videoId === 'string') return ytdFlexyElm.videoId;
      console.log('video id not found');
      return '';
    };

    // eslint-disable-next-line no-unused-vars
    const holdInlineExpanderAlwaysExpanded = inlineExpanderCnt => {
      console.log('holdInlineExpanderAlwaysExpanded');
      if (inlineExpanderCnt.alwaysShowExpandButton === true) {
        inlineExpanderCnt.alwaysShowExpandButton = false;
      }
      if (typeof (inlineExpanderCnt.collapseLabel || 0) === 'string') {
        inlineExpanderCnt.collapseLabel = '';
      }
      if (typeof (inlineExpanderCnt.expandLabel || 0) === 'string') {
        inlineExpanderCnt.expandLabel = '';
      }
      if (inlineExpanderCnt.showCollapseButton === true) {
        inlineExpanderCnt.showCollapseButton = false;
      }
      if (inlineExpanderCnt.showExpandButton === true) inlineExpanderCnt.showExpandButton = false;
      if (inlineExpanderCnt.expandButton instanceof HTMLElement_) {
        inlineExpanderCnt.expandButton = null;
        inlineExpanderCnt.expandButton.remove();
      }
    };

    const fixInlineExpanderDisplay = inlineExpanderCnt => {
      try {
        inlineExpanderCnt.updateIsAttributedExpanded();
      } catch (e) {
        console.warn('[YouTube+] updateIsAttributedExpanded failed:', e);
      }
      try {
        inlineExpanderCnt.updateIsFormattedExpanded();
      } catch (e) {
        console.warn('[YouTube+] updateIsFormattedExpanded failed:', e);
      }
      try {
        inlineExpanderCnt.updateTextOnSnippetTypeChange();
      } catch (e) {
        console.warn('[YouTube+] updateTextOnSnippetTypeChange failed:', e);
      }
      try {
        inlineExpanderCnt.updateStyles();
      } catch (e) {
        console.warn('[YouTube+] updateStyles failed:', e);
      }
    };

    const fixInlineExpanderMethods = inlineExpanderCnt => {
      if (inlineExpanderCnt && !inlineExpanderCnt.__$$idncjk8487$$__) {
        inlineExpanderCnt.__$$idncjk8487$$__ = true;
        inlineExpanderCnt.updateTextOnSnippetTypeChange = function () {
          true || (this.isResetMutation && this.mutationCallback());
        };
        // inlineExpanderCnt.hasAttributedStringText = true;
        inlineExpanderCnt.isResetMutation = true;
        fixInlineExpanderDisplay(inlineExpanderCnt); // do the initial fix
      }
    };

    const fixInlineExpanderContent = () => {
      // console.log(21886,1)
      const mainInfo = getMainInfo();
      if (!mainInfo) return;
      // console.log(21886,2)
      const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
      const inlineExpanderCnt = insp(inlineExpanderElm);
      fixInlineExpanderMethods(inlineExpanderCnt);

      // console.log(21886, 3)
      // if (inlineExpanderCnt && inlineExpanderCnt.isExpanded === true && plugin.autoExpandInfoDesc.activated) {
      //   // inlineExpanderCnt.isExpandedChanged();
      //   // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
      // }
      // if(inlineExpanderCnt){
      //   // console.log(21886,4, inlineExpanderCnt.isExpanded, inlineExpanderCnt.isTruncated)
      //   if (inlineExpanderCnt.isExpanded === false && inlineExpanderCnt.isTruncated === true) {
      //     // console.log(21881)
      //     inlineExpanderCnt.isTruncated = false;
      //   }
      // }
    };

    const plugin = {
      minibrowser: {
        activated: false,
        toUse: true, // depends on shouldUseMiniPlayer()
        activate() {
          if (this.activated) return;

          // Use global isPassiveArgSupport constant
          // https://caniuse.com/?search=observer
          // https://caniuse.com/?search=addEventListener%20passive

          if (!isPassiveArgSupport) return;

          this.activated = true;

          const ytdAppElm = document.querySelector('ytd-app');
          const ytdAppCnt = insp(ytdAppElm);

          if (!ytdAppCnt) return;

          const cProto = ytdAppCnt.constructor.prototype;

          if (!cProto.handleNavigate) return;

          if (cProto.handleNavigate.__ma355__) return;

          cProto.handleNavigate = handleNavigateFactory(cProto.handleNavigate);

          cProto.handleNavigate.__ma355__ = 1;
        },
      },
      autoExpandInfoDesc: {
        activated: false,
        toUse: false, // false by default; once the expand is clicked, maintain the feature until the browser is closed.
        /** @type { MutationObserver | null } */
        mo: null,
        promiseReady: new PromiseExternal(),
        moFn(lockId) {
          if (lockGet['autoExpandInfoDescAttrAsyncLock'] !== lockId) return;

          const mainInfo = getMainInfo();

          if (!mainInfo) return;
          switch (((mainInfo || 0).nodeName || '').toLowerCase()) {
            case 'ytd-expander':
              if (mainInfo.hasAttribute000('collapsed')) {
                let success = false;
                try {
                  insp(mainInfo).handleMoreTap(new Event('tap'));
                  success = true;
                } catch {}
                if (success) mainInfo.setAttribute111('tyt-no-less-btn', '');
              }
              break;
            case 'ytd-expandable-video-description-body-renderer':
              const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
              const inlineExpanderCnt = insp(inlineExpanderElm);
              if (inlineExpanderCnt && inlineExpanderCnt.isExpanded === false) {
                inlineExpanderCnt.isExpanded = true;
                inlineExpanderCnt.isExpandedChanged();
                // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
              }
              break;
          }
        },
        activate() {
          if (this.activated) return;

          this.moFn = this.moFn.bind(this);
          this.mo = new MutationObserver(() => {
            Promise.resolve(lockSet['autoExpandInfoDescAttrAsyncLock'])
              .then(this.moFn)
              .catch(console.warn);
          });
          this.activated = true;
          this.promiseReady.resolve();
        },
        async onMainInfoSet(mainInfo) {
          await this.promiseReady.then();
          if (mainInfo.nodeName.toLowerCase() === 'ytd-expander') {
            this.mo.observe(mainInfo, {
              attributes: true,
              attributeFilter: ['collapsed', 'attr-8ifv7'],
            });
          } else {
            this.mo.observe(mainInfo, { attributes: true, attributeFilter: ['attr-8ifv7'] });
          }
          mainInfo.incAttribute111('attr-8ifv7');
        },
      },
      fullChannelNameOnHover: {
        activated: false,
        toUse: true,
        /** @type { MutationObserver | null } */
        mo: null,
        /** @type { ResizeObserver | null} */
        ro: null,
        promiseReady: new PromiseExternal(),
        checkResize: 0,
        mouseEnterFn(evt) {
          const target = evt ? evt.target : null;
          if (!(target instanceof HTMLElement_)) return;
          const metaDataElm = target.closest('ytd-watch-metadata');
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          this.checkResize = Date.now() + 300;
          metaDataElm.classList.add('tyt-metadata-hover');
          // console.log('mouseEnter')
        },
        mouseLeaveFn(evt) {
          const target = evt ? evt.target : null;
          if (!(target instanceof HTMLElement_)) return;
          const metaDataElm = target.closest('ytd-watch-metadata');
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          metaDataElm.classList.remove('tyt-metadata-hover');
          // console.log('mouseLeaveFn')
        },
        moFn(lockId) {
          if (lockGet['fullChannelNameOnHoverAttrAsyncLock'] !== lockId) return;

          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;

          const evtOpt = { passive: true, capture: false };
          uploadInfo.removeEventListener('pointerenter', this.mouseEnterFn, evtOpt);
          uploadInfo.removeEventListener('pointerleave', this.mouseLeaveFn, evtOpt);

          uploadInfo.addEventListener('pointerenter', this.mouseEnterFn, evtOpt);
          uploadInfo.addEventListener('pointerleave', this.mouseLeaveFn, evtOpt);
        },
        async onNavigateFinish() {
          await this.promiseReady.then();
          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;
          this.mo.observe(uploadInfo, {
            attributes: true,
            attributeFilter: ['hidden', 'attr-3wb0k'],
          });
          uploadInfo.incAttribute111('attr-3wb0k');
          this.ro.observe(uploadInfo);
        },
        activate() {
          if (this.activated) return;

          // Use global isPassiveArgSupport constant
          // https://caniuse.com/?search=observer
          // https://caniuse.com/?search=addEventListener%20passive

          if (!isPassiveArgSupport) return;

          this.activated = true;

          this.mouseEnterFn = this.mouseEnterFn.bind(this);
          this.mouseLeaveFn = this.mouseLeaveFn.bind(this);

          this.moFn = this.moFn.bind(this);
          this.mo = new MutationObserver(() => {
            Promise.resolve(lockSet['fullChannelNameOnHoverAttrAsyncLock'])
              .then(this.moFn)
              .catch(console.warn);
          });
          this.ro = new ResizeObserver(mutations => {
            if (Date.now() > this.checkResize) return;
            for (const mutation of mutations) {
              const uploadInfo = mutation.target;
              if (uploadInfo && mutation.contentRect.width > 0 && mutation.contentRect.height > 0) {
                const metaDataElm = uploadInfo.closest('ytd-watch-metadata');
                if (metaDataElm.classList.contains('tyt-metadata-hover')) {
                  metaDataElm.classList.add('tyt-metadata-hover-resized');
                }

                break;
              }
            }
          });
          this.promiseReady.resolve();
        },
      },
      'external.ytlstm': {
        activated: false,
        toUse: true, // depends on shouldUseMiniPlayer()
        activate() {
          if (this.activated) return;

          this.activated = true;
          document.documentElement.classList.add('external-ytlstm');
        },
      },
    };

    if (sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__) plugin.autoExpandInfoDesc.toUse = true;

    // let shouldFixInfo = false;
    const __attachedSymbol__ = Symbol();

    const makeInitAttached = tag => {
      const inPageRearrange_ = inPageRearrange;
      inPageRearrange = false;
      for (const elm of document.querySelectorAll(`${tag}`)) {
        const cnt = insp(elm) || 0;
        if (typeof cnt.attached498 === 'function' && !elm[__attachedSymbol__]) {
          Promise.resolve(elm).then(eventMap[`${tag}::attached`]).catch(console.warn);
        }
      }
      inPageRearrange = inPageRearrange_;
    };

    const getGeneralChatElement = async () => {
      for (let i = 2; i-- > 0; ) {
        const t = document.querySelector(
          '#columns.style-scope.ytd-watch-flexy ytd-live-chat-frame#chat'
        );
        if (t instanceof Element) return t;
        if (i > 0) {
          // try later
          console.log('ytd-live-chat-frame::attached - delayPn(200)');
          await delayPn(200);
        }
      }
      return null;
    };

    const nsTemplateObtain = () => {
      let nsTemplate = document.querySelector('ytd-watch-flexy noscript[ns-template]');
      if (!nsTemplate) {
        nsTemplate = document.createElement('noscript');
        nsTemplate.setAttribute('ns-template', '');
        document.querySelector('ytd-watch-flexy').appendChild(nsTemplate);
      }
      return nsTemplate;
    };

    const isPageDOM = (elm, selector) => {
      if (!elm || !(elm instanceof Element) || !elm.nodeName) return false;
      if (!elm.closest(selector)) return false;
      if (elm.isConnected !== true) return false;
      return true;
    };

    const invalidFlexyParent = hostElement => {
      if (hostElement instanceof HTMLElement) {
        const hasFlexyParent = HTMLElement.prototype.closest.call(hostElement, 'ytd-watch-flexy'); // eg short
        if (!hasFlexyParent) return true;
        const currentFlexy = elements.flexy;
        if (currentFlexy && currentFlexy !== hasFlexyParent) return true;
      }
      return false;
    };

    // const mutationComment = document.createComment('1');
    // let mutationPromise = new PromiseExternal();
    // const mutationPromiseObs = new MutationObserver(()=>{
    //   mutationPromise.resolve();
    //   mutationPromise = new PromiseExternal();
    // });
    // mutationPromiseObs.observe(mutationComment, {characterData: true});

    let headerMutationObserver = null;
    let headerMutationTmpNode = null;

    const eventMap = {
      ceHack: () => {
        mLoaded.flag |= 2;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());

        retrieveCE('ytd-watch-flexy')
          .then(eventMap['ytd-watch-flexy::defined'])
          .catch(console.warn);
        retrieveCE('ytd-expander').then(eventMap['ytd-expander::defined']).catch(console.warn);
        retrieveCE('ytd-watch-next-secondary-results-renderer')
          .then(eventMap['ytd-watch-next-secondary-results-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-watch-next-secondary-results-renderer failed:',
              err
            )
          );
        retrieveCE('ytd-comments-header-renderer')
          .then(eventMap['ytd-comments-header-renderer::defined'])
          .catch(err =>
            console.warn('[YouTube+] retrieveCE ytd-comments-header-renderer failed:', err)
          );
        retrieveCE('ytd-live-chat-frame')
          .then(eventMap['ytd-live-chat-frame::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-live-chat-frame failed:', err));
        retrieveCE('ytd-comments')
          .then(eventMap['ytd-comments::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-comments failed:', err));
        retrieveCE('ytd-engagement-panel-section-list-renderer')
          .then(eventMap['ytd-engagement-panel-section-list-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-engagement-panel-section-list-renderer failed:',
              err
            )
          );
        retrieveCE('ytd-watch-metadata')
          .then(eventMap['ytd-watch-metadata::defined'])
          .catch(err => console.warn('[YouTube+] retrieveCE ytd-watch-metadata failed:', err));
        retrieveCE('ytd-playlist-panel-renderer')
          .then(eventMap['ytd-playlist-panel-renderer::defined'])
          .catch(err =>
            console.warn('[YouTube+] retrieveCE ytd-playlist-panel-renderer failed:', err)
          );
        retrieveCE('ytd-expandable-video-description-body-renderer')
          .then(eventMap['ytd-expandable-video-description-body-renderer::defined'])
          .catch(err =>
            console.warn(
              '[YouTube+] retrieveCE ytd-expandable-video-description-body-renderer failed:',
              err
            )
          );
      },

      fixForTabDisplay: isResize => {
        // isResize is true if the layout is resized (not due to tab switching)
        // youtube components shall handle the resize issue. can skip some checkings.

        bFixForResizedTabLater = false;
        for (const element of document.querySelectorAll('[io-intersected]')) {
          const cnt = insp(element);
          if (element instanceof HTMLElement_ && typeof cnt.calculateCanCollapse === 'function') {
            try {
              cnt.calculateCanCollapse(true);
            } catch (e) {
              console.warn('[YouTube+] calculateCanCollapse failed:', e);
            }
          }
        }

        if (!isResize && lastTab === '#tab-info') {
          // #tab-info is now shown.
          // to fix the sizing issue (description info cards in tab info)
          for (const element of document.querySelectorAll(
            '#tab-info ytd-video-description-infocards-section-renderer, #tab-info yt-chip-cloud-renderer, #tab-info ytd-horizontal-card-list-renderer, #tab-info yt-horizontal-list-renderer'
          )) {
            const cnt = insp(element);
            if (element instanceof HTMLElement_ && typeof cnt.notifyResize === 'function') {
              try {
                cnt.notifyResize();
              } catch (e) {
                console.warn('[YouTube+] notifyResize failed for tab-info:', e);
              }
            }
          }
          // to fix expand/collapse sizing issue (inline-expander in tab info)
          // for example, expand button is required but not shown as it was rendered in the hidden state
          for (const element of document.querySelectorAll('#tab-info ytd-text-inline-expander')) {
            const cnt = insp(element);
            if (element instanceof HTMLElement_ && typeof cnt.resize === 'function') {
              cnt.resize(false); // reflow due to offsetWidth calling
            }
            fixInlineExpanderDisplay(cnt); // just in case
          }
        }

        if (!isResize && typeof lastTab === 'string' && lastTab.startsWith('#tab-')) {
          const tabContent = document.querySelector('.tab-content-cld:not(.tab-content-hidden)');
          if (tabContent) {
            const renderers = tabContent.querySelectorAll('yt-chip-cloud-renderer');
            for (const renderer of renderers) {
              const cnt = insp(renderer);
              if (typeof cnt.notifyResize === 'function') {
                try {
                  cnt.notifyResize();
                } catch (e) {
                  console.warn('[YouTube+] notifyResize failed for renderer:', e);
                }
              }
            }
          }
        }
      },

      'ytd-watch-flexy::defined': cProto => {
        if (
          !cProto.updateChatLocation498 &&
          typeof cProto.updateChatLocation === 'function' &&
          cProto.updateChatLocation.length === 0
        ) {
          cProto.updateChatLocation498 = cProto.updateChatLocation;
          cProto.updateChatLocation = updateChatLocation498;
        }
      },

      'ytd-watch-next-secondary-results-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-next-secondary-results-renderer');
      },

      'ytd-watch-next-secondary-results-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-watch-next-secondary-results-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('#columns #related ytd-watch-next-secondary-results-renderer') &&
          !hostElement.matches(
            '#right-tabs ytd-watch-next-secondary-results-renderer, [hidden] ytd-watch-next-secondary-results-renderer'
          )
        ) {
          elements.related = hostElement.closest('#related');
          hostElement.setAttribute111('tyt-videos-list', '');
        }
        // console.log('ytd-watch-next-secondary-results-renderer::attached', hostElement);
      },

      'ytd-watch-next-secondary-results-renderer::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-watch-next-secondary-results-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        if (hostElement.hasAttribute000('tyt-videos-list')) {
          elements.related = null;
          hostElement.removeAttribute000('tyt-videos-list');
        }
        console.log('ytd-watch-next-secondary-results-renderer::detached', hostElement);
      },

      settingCommentsVideoId: hostElement => {
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        const cnt = insp(hostElement);
        const commentsArea = elements.comments;
        if (
          commentsArea !== hostElement ||
          hostElement.isConnected !== true ||
          cnt.isAttached !== true ||
          !cnt.data ||
          cnt.hidden !== false
        ) {
          return;
        }
        const ytdFlexyElm = elements.flexy;
        const ytdFlexyCnt = ytdFlexyElm ? insp(ytdFlexyElm) : null;
        if (ytdFlexyCnt && ytdFlexyCnt.videoId) {
          hostElement.setAttribute111('tyt-comments-video-id', ytdFlexyCnt.videoId);
        } else {
          hostElement.removeAttribute000('tyt-comments-video-id');
        }
      },
      checkCommentsShouldBeHidden: lockId => {
        if (lockGet['checkCommentsShouldBeHiddenLock'] !== lockId) return;

        // commentsArea's attribute: tyt-comments-video-id
        // ytdFlexyElm's attribute: video-id

        const commentsArea = elements.comments;
        const ytdFlexyElm = elements.flexy;
        if (commentsArea && ytdFlexyElm && !commentsArea.hasAttribute000('hidden')) {
          const ytdFlexyCnt = insp(ytdFlexyElm);
          if (typeof ytdFlexyCnt.videoId === 'string') {
            const commentsVideoId = commentsArea.getAttribute('tyt-comments-video-id');
            if (commentsVideoId && commentsVideoId !== ytdFlexyCnt.videoId) {
              commentsArea.setAttribute111('hidden', '');
              // removeKeepCommentsScroller();
            }
          }
        }
      },
      'ytd-comments::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::attached'])
                .catch(console.warn);
            }
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::detached'])
                .catch(console.warn);
            }
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
            return this.detached498();
          };
        }

        cProto._createPropertyObserver('data', '_dataChanged498', undefined);
        cProto._dataChanged498 = function () {
          // console.log('_dataChanged498', this.hostElement)
          Promise.resolve(this.hostElement)
            .then(eventMap['ytd-comments::_dataChanged498'])
            .catch(console.warn);
        };

        // if (!cProto.dataChanged498_ && typeof cProto.dataChanged_ === 'function') {
        //   cProto.dataChanged498_ = cProto.dataChanged_;
        //   cProto.dataChanged_ = function () {
        //     Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(console.warn);
        //     return this.dataChanged498_();
        //   }
        // }

        makeInitAttached('ytd-comments');
      },

      'ytd-comments::_dataChanged498': hostElement => {
        // console.log(18984, hostElement.hasAttribute('tyt-comments-area'))
        if (!hostElement.hasAttribute000('tyt-comments-area')) return;
        let commentsDataStatus = 0;
        const cnt = insp(hostElement);
        const data = cnt ? cnt.data : null;
        const contents = data ? data.contents : null;
        if (data) {
          if (contents && contents.length === 1 && contents[0].messageRenderer) {
            commentsDataStatus = 2;
          }
          if (contents && contents.length > 1 && contents[0].commentThreadRenderer) {
            commentsDataStatus = 1;
          }
        }
        if (commentsDataStatus) {
          hostElement.setAttribute111('tyt-comments-data-status', commentsDataStatus);
          // ytdFlexyElm.setAttribute111('tyt-comment-disabled', '')
        } else {
          // ytdFlexyElm.removeAttribute000('tyt-comment-disabled')
          hostElement.removeAttribute000('tyt-comments-data-status');
        }
        Promise.resolve(hostElement).then(eventMap['settingCommentsVideoId']).catch(console.warn);
      },

      'ytd-comments::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || hostElement.id !== 'comments') return;
        // if (!hostElement || hostElement.closest('[hidden]')) return;
        elements.comments = hostElement;
        console.log('ytd-comments::attached');
        Promise.resolve(hostElement).then(eventMap['settingCommentsVideoId']).catch(console.warn);

        aoComment.observe(hostElement, { attributes: true });
        hostElement.setAttribute111('tyt-comments-area', '');

        const lockId = lockSet['rightTabReadyLock02'];
        await rightTabsProvidedPromise.then();
        if (lockGet['rightTabReadyLock02'] !== lockId) return;

        if (elements.comments !== hostElement) return;
        if (hostElement.isConnected === false) return;
        DEBUG_5085 && console.log(7932, 'comments');

        // if(!elements.comments || elements.comments.isConnected === false) return;
        if (hostElement && !hostElement.closest('#right-tabs')) {
          document.querySelector('#tab-comments').assignChildren111(null, hostElement, null);
        } else {
          const shouldTabVisible =
            elements.comments &&
            elements.comments.closest('#tab-comments') &&
            !elements.comments.closest('[hidden]');

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);

          //   document.querySelector('#tab-comments').classList.remove('tab-content-hidden')
          //   document.querySelector('[tyt-tab-content="#tab-comments"]').classList.remove('tab-btn-hidden')

          Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
            .then(removeKeepCommentsScroller)
            .catch(console.warn);
        }

        TAB_AUTO_SWITCH_TO_COMMENTS && switchToTab('#tab-comments');
      },
      'ytd-comments::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments::detached');
        // console.log(858, hostElement)
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;

        if (hostElement.hasAttribute000('tyt-comments-area')) {
          // foComments.disconnect();
          // foComments.takeRecords();
          hostElement.removeAttribute000('tyt-comments-area');
          // document.querySelector('#tab-comments').classList.add('tab-content-hidden')
          // document.querySelector('[tyt-tab-content="#tab-comments"]').classList.add('tab-btn-hidden')

          aoComment.disconnect();
          aoComment.takeRecords();
          elements.comments = null;

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.add('tab-btn-hidden');

          Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
            .then(removeKeepCommentsScroller)
            .catch(console.warn);
        }
      },

      'ytd-comments-header-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::attached'])
                .catch(console.warn);
            }
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(console.warn); // force dataChanged on attached
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        if (!cProto.dataChanged498 && typeof cProto.dataChanged === 'function') {
          cProto.dataChanged498 = cProto.dataChanged;
          cProto.dataChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(console.warn);
            return this.dataChanged498();
          };
        }

        makeInitAttached('ytd-comments-header-renderer');
      },

      'ytd-comments-header-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments-header-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || !hostElement.classList.contains('ytd-item-section-renderer')) return;
        // console.log(12991, 'ytd-comments-header-renderer::attached')
        const targetElement = document.querySelector(
          '[tyt-comments-area] ytd-comments-header-renderer'
        );
        if (hostElement === targetElement) {
          hostElement.setAttribute111('tyt-comments-header-field', '');
        } else {
          const parentNode = hostElement.parentNode;
          if (
            parentNode instanceof HTMLElement_ &&
            parentNode.querySelector('[tyt-comments-header-field]')
          ) {
            hostElement.setAttribute111('tyt-comments-header-field', '');
          }
        }
      },

      'ytd-comments-header-renderer::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-comments-header-renderer::detached');

        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(12992, 'ytd-comments-header-renderer::detached')
        if (hostElement.hasAttribute000('field-of-cm-count')) {
          hostElement.removeAttribute000('field-of-cm-count');

          const cmCount = document.querySelector('#tyt-cm-count');
          if (
            cmCount &&
            !document.querySelector('#tab-comments ytd-comments-header-renderer[field-of-cm-count]')
          ) {
            cmCount.textContent = '';
          }
        }
        if (hostElement.hasAttribute000('tyt-comments-header-field')) {
          hostElement.removeAttribute000('tyt-comments-header-field');
        }
      },

      'ytd-comments-header-renderer::dataChanged': hostElement => {
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }

        const ytdFlexyElm = elements.flexy;

        let b = false;
        const cnt = insp(hostElement);
        if (
          cnt &&
          hostElement.closest('#tab-comments') &&
          document.querySelector('#tab-comments ytd-comments-header-renderer') === hostElement
        ) {
          b = true;
        } else if (
          hostElement instanceof HTMLElement_ &&
          hostElement.parentNode instanceof HTMLElement_ &&
          hostElement.parentNode.querySelector('[tyt-comments-header-field]')
        ) {
          b = true;
        }
        if (b) {
          hostElement.setAttribute111('tyt-comments-header-field', '');
          ytdFlexyElm && ytdFlexyElm.removeAttribute000('tyt-comment-disabled');
        }

        if (
          hostElement.hasAttribute000('tyt-comments-header-field') &&
          hostElement.isConnected === true
        ) {
          if (!headerMutationObserver) {
            headerMutationObserver = new MutationObserver(
              eventMap['ytd-comments-header-renderer::deferredCounterUpdate']
            );
          }
          headerMutationObserver.observe(hostElement.parentNode, {
            subtree: false,
            childList: true,
          });
          if (!headerMutationTmpNode) {
            headerMutationTmpNode = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          }
          const tmpNode = headerMutationTmpNode;
          hostElement.insertAdjacentElement('afterend', tmpNode);
          tmpNode.remove();
        }
      },

      'ytd-comments-header-renderer::deferredCounterUpdate': () => {
        const nodes = document.querySelectorAll(
          '#tab-comments ytd-comments-header-renderer[class]'
        );
        if (nodes.length === 1) {
          const hostElement = nodes[0];
          const cnt = insp(hostElement);
          const data = cnt.data;
          if (!data) return;
          let ez = '';
          if (
            data.commentsCount &&
            data.commentsCount.runs &&
            data.commentsCount.runs.length >= 1
          ) {
            let max = -1;
            const z = data.commentsCount.runs
              .map(e => {
                const c = e.text.replace(/\D+/g, '').length;
                if (c > max) max = c;
                return [e.text, c];
              })
              .filter(a => a[1] === max);
            if (z.length >= 1) {
              ez = z[0][0];
            }
          } else if (data.countText && data.countText.runs && data.countText.runs.length >= 1) {
            let max = -1;
            const z = data.countText.runs
              .map(e => {
                const c = e.text.replace(/\D+/g, '').length;
                if (c > max) max = c;
                return [e.text, c];
              })
              .filter(a => a[1] === max);
            if (z.length >= 1) {
              ez = z[0][0];
            }
          }
          const cmCount = document.querySelector('#tyt-cm-count');
          if (ez) {
            hostElement.setAttribute111('field-of-cm-count', '');
            cmCount && (cmCount.textContent = ez.trim());
          } else {
            hostElement.removeAttribute000('field-of-cm-count');
            cmCount && (cmCount.textContent = '');
            console.warn('no text for #tyt-cm-count');
          }
        }
      },

      'ytd-expander::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }
        if (!cProto.calculateCanCollapse498 && typeof cProto.calculateCanCollapse === 'function') {
          cProto.calculateCanCollapse498 = cProto.calculateCanCollapse;
          cProto.calculateCanCollapse = funcCanCollapse;
        }

        if (!cProto.childrenChanged498 && typeof cProto.childrenChanged === 'function') {
          cProto.childrenChanged498 = cProto.childrenChanged;
          cProto.childrenChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-expander::childrenChanged'])
              .catch(console.warn);
            return this.childrenChanged498();
          };
        }

        /*
                 
                        console.log('ytd-expander::defined 01');
                        
                        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback = connectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback)
                        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback = disconnectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback)
                        
                        console.log('ytd-expander::defined 02');
                 
                        */

        makeInitAttached('ytd-expander');
      },

      'ytd-expander::childrenChanged': hostElement => {
        if (
          hostElement instanceof Node &&
          hostElement.hasAttribute000('hidden') &&
          hostElement.hasAttribute000('tyt-main-info') &&
          hostElement.firstElementChild
        ) {
          hostElement.removeAttribute('hidden');
        }
      },

      'ytd-expandable-video-description-body-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-expandable-video-description-body-renderer');
      },

      'ytd-expandable-video-description-body-renderer::attached': async hostElement => {
        if (
          hostElement instanceof HTMLElement_ &&
          isPageDOM(hostElement, '[tyt-info-renderer]') &&
          !hostElement.matches('[tyt-main-info]')
        ) {
          elements.infoExpander = hostElement;
          console.log(128384, elements.infoExpander);

          // console.log(1299, hostElement.parentNode, isRightTabsInserted)

          infoExpanderElementProvidedPromise.resolve();
          hostElement.setAttribute111('tyt-main-info', '');
          if (plugin.autoExpandInfoDesc.toUse) {
            plugin.autoExpandInfoDesc.onMainInfoSet(hostElement);
          }

          const lockId = lockSet['rightTabReadyLock03'];
          await rightTabsProvidedPromise.then();
          if (lockGet['rightTabReadyLock03'] !== lockId) return;

          if (elements.infoExpander !== hostElement) return;
          if (hostElement.isConnected === false) return;
          console.log(7932, 'infoExpander');

          elements.infoExpander.classList.add('tyt-main-info'); // add a classname for it

          const infoExpander = elements.infoExpander;
          // const infoExpanderBack = elements.infoExpanderBack;

          // console.log(5438,infoExpander, qt);

          // const dummy = document.createElement('noscript');
          // dummy.setAttribute000('id', 'info-expander-vid');
          // dummy.setAttribute000('video-id', getCurrentVideoId());
          // infoExpander.insertBefore000(dummy, infoExpander.firstChild);

          // aoInfo.observe(infoExpander, { attributes: true, attributeFilter: ['tyt-display-for', 'tyt-video-id'] });
          // zoInfo.observe(infoExpanderBack, { attributes: true, attributeFilter: ['hidden', 'attr-w20ts'], childList: true, subtree: true});
          // new MutationObserver(()=>{
          //   console.log(591499)
          // }).observe(infoExpanderBack, {childList: true, subtree: true})

          const inlineExpanderElm = infoExpander.querySelector('ytd-text-inline-expander');
          if (inlineExpanderElm) {
            const mo = new MutationObserver(() => {
              const p = document.querySelector('#tab-info ytd-text-inline-expander');
              sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__ =
                p && p.hasAttribute('is-expanded') ? '1' : '';
              if (p) fixInlineExpanderContent();
            });
            mo.observe(inlineExpanderElm, {
              attributes: ['is-expanded', 'attr-6v8qu', 'hidden'],
              subtree: true,
            }); // hidden + subtree to trigger the fn by delayedUpdate
            inlineExpanderElm.incAttribute111('attr-6v8qu');
            const cnt = insp(inlineExpanderElm);

            if (cnt) fixInlineExpanderDisplay(cnt);
          }

          if (infoExpander && !infoExpander.closest('#right-tabs')) {
            document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
          } else {
            if (document.querySelector('[tyt-tab-content="#tab-info"]')) {
              const shouldTabVisible =
                elements.infoExpander && elements.infoExpander.closest('#tab-info');
              document
                .querySelector('[tyt-tab-content="#tab-info"]')
                .classList.toggle('tab-btn-hidden', !shouldTabVisible);
            }
          }

          Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn); // required when the page is switched from channel to watch

          // if (infoExpander && infoExpander.closest('#right-tabs')) Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);

          // infoExpanderBack.incAttribute111('attr-w20ts');

          // return;
        }

        DEBUG_5084 && console.log(5084, 'ytd-expandable-video-description-body-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;

        if (isPageDOM(hostElement, '#tab-info [tyt-main-info]')) {
          // const cnt = insp(hostElement);
          // if(cnt.data){
          //   cnt.data = Object.assign({}, cnt.data);
          // }
        } else if (!hostElement.closest('#tab-info')) {
          const bodyRenderer = hostElement;
          let bodyRendererNew = document.querySelector(
            'ytd-expandable-video-description-body-renderer[tyt-info-renderer]'
          );
          if (!bodyRendererNew) {
            bodyRendererNew = document.createElement(
              'ytd-expandable-video-description-body-renderer'
            );
            bodyRendererNew.setAttribute('tyt-info-renderer', '');
            nsTemplateObtain().appendChild(bodyRendererNew);
          }
          // document.querySelector('#tab-info').assignChildren111(null, bodyRendererNew, null);

          const cnt = insp(bodyRendererNew);
          cnt.data = Object.assign({}, insp(bodyRenderer).data);

          const inlineExpanderElm = bodyRendererNew.querySelector('ytd-text-inline-expander');
          const inlineExpanderCnt = insp(inlineExpanderElm);
          fixInlineExpanderMethods(inlineExpanderCnt);

          // insp(bodyRendererNew).data = insp(bodyRenderer).data;

          // if((bodyRendererNew.hasAttribute('hidden')?1:0)^(bodyRenderer.hasAttribute('hidden')?1:0)){
          //   if(bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
          //   else bodyRendererNew.removeAttribute('hidden');
          // }

          elements.infoExpanderRendererBack = bodyRenderer;
          elements.infoExpanderRendererFront = bodyRendererNew;
          bodyRenderer.setAttribute('tyt-info-renderer-back', '');
          bodyRendererNew.setAttribute('tyt-info-renderer-front', '');

          // elements.infoExpanderBack = {{ytd-expander}};
        }
      },

      'ytd-expandable-video-description-body-renderer::detached': async hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(5992, hostElement)
        if (hostElement.hasAttribute000('tyt-main-info')) {
          DEBUG_5084 &&
            console.log(5084, 'ytd-expandable-video-description-body-renderer::detached');
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      'ytd-expander::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        // console.log(4959, hostElement)

        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('[tyt-comments-area] #contents ytd-expander#expander') &&
          !hostElement.matches('[hidden] ytd-expander#expander')
        ) {
          hostElement.setAttribute111('tyt-content-comment-entry', '');
          ioComment.observe(hostElement);
        }

        // --------------

        // else if (hostElement instanceof HTMLElement_ && hostElement.matches('ytd-expander#expander.style-scope.ytd-expandable-video-description-body-renderer')) {
        //   //  && !hostElement.matches('#right-tabs ytd-expander#expander, [hidden] ytd-expander#expander')

        //   console.log(5084, 'ytd-expander::attached');
        //   const bodyRenderer = hostElement.closest('ytd-expandable-video-description-body-renderer');
        //   let bodyRendererNew = document.querySelector('ytd-expandable-video-description-body-renderer[tyt-info-renderer]');
        //   if (!bodyRendererNew) {
        //     bodyRendererNew = document.createElement('ytd-expandable-video-description-body-renderer');
        //     bodyRendererNew.setAttribute('tyt-info-renderer', '');
        //     nsTemplateObtain().appendChild(bodyRendererNew);
        //   }
        //   // document.querySelector('#tab-info').assignChildren111(null, bodyRendererNew, null);

        //   insp(bodyRendererNew).data = insp(bodyRenderer).data;
        //   // if((bodyRendererNew.hasAttribute('hidden')?1:0)^(bodyRenderer.hasAttribute('hidden')?1:0)){
        //   //   if(bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
        //   //   else bodyRendererNew.removeAttribute('hidden');
        //   // }

        //   elements.infoExpanderRendererBack = bodyRenderer;
        //   elements.infoExpanderRendererFront = bodyRendererNew;
        //   bodyRenderer.setAttribute('tyt-info-renderer-back','')
        //   bodyRendererNew.setAttribute('tyt-info-renderer-front','')

        //   elements.infoExpanderBack = hostElement;

        // }

        // --------------

        // console.log('ytd-expander::attached', hostElement);
      },

      'ytd-expander::detached': hostElement => {
        // if (inPageRearrange) return;
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        // console.log(5992, hostElement)
        if (hostElement.hasAttribute000('tyt-content-comment-entry')) {
          ioComment.unobserve(hostElement);
          hostElement.removeAttribute000('tyt-content-comment-entry');
        } else if (hostElement.hasAttribute000('tyt-main-info')) {
          DEBUG_5084 && console.log(5084, 'ytd-expander::detached');
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
        // console.log('ytd-expander::detached', hostElement);
      },

      'ytd-live-chat-frame::defined': cProto => {
        // eslint-disable-next-line no-unused-vars
        let lastDomAction = 0;

        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            lastDomAction = Date.now();
            // console.log('chat868-attached', Date.now());
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            lastDomAction = Date.now();
            // console.log('chat868-detached', Date.now());
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        if (
          typeof cProto.urlChanged === 'function' &&
          !cProto.urlChanged66 &&
          !cProto.urlChangedAsync12 &&
          cProto.urlChanged.length === 0
        ) {
          cProto.urlChanged66 = cProto.urlChanged;
          let ath = 0;
          cProto.urlChangedAsync12 = async function () {
            await this.__urlChangedAsyncT689__;
            const t = (ath = (ath & 1073741823) + 1);
            const chatframe = this.chatframe || (this.$ || 0).chatframe || 0;
            if (chatframe instanceof HTMLIFrameElement) {
              if (chatframe.contentDocument === null) {
                await Promise.resolve('#').catch(console.warn);
                if (t !== ath) return;
              }
              await new Promise(resolve => setTimeout_(resolve, 1)).catch(console.warn); // neccessary for Brave
              if (t !== ath) return;
              const isBlankPage = !this.data || this.collapsed;
              const p1 = new Promise(resolve => setTimeout_(resolve, 706)).catch(console.warn);
              const p2 = new Promise(resolve => {
                new IntersectionObserver((entries, observer) => {
                  for (const entry of entries) {
                    const rect = entry.boundingClientRect || 0;
                    if (isBlankPage || (rect.width > 0 && rect.height > 0)) {
                      observer.disconnect();
                      resolve('#');
                      break;
                    }
                  }
                }).observe(chatframe);
              }).catch(console.warn);
              await Promise.race([p1, p2]);
              if (t !== ath) return;
            }
            this.urlChanged66();
          };
          cProto.urlChanged = function () {
            const t = (this.__urlChangedAsyncT688__ =
              (this.__urlChangedAsyncT688__ & 1073741823) + 1);
            nextBrowserTick(() => {
              if (t !== this.__urlChangedAsyncT688__) return;
              this.urlChangedAsync12();
            });
          };
        }

        makeInitAttached('ytd-live-chat-frame');
      },

      'ytd-live-chat-frame::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-live-chat-frame::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        if (!hostElement || hostElement.id !== 'chat') return;
        console.log('ytd-live-chat-frame::attached');

        const lockId = lockSet['ytdLiveAttachedLock'];
        const chatElem = await getGeneralChatElement();
        if (lockGet['ytdLiveAttachedLock'] !== lockId) return;

        if (chatElem === hostElement) {
          elements.chat = chatElem;
          aoChat.observe(chatElem, { attributes: true });
          const isFlexyReady = elements.flexy instanceof Element;
          chatElem.setAttribute111('tyt-active-chat-frame', isFlexyReady ? 'CF' : 'C');

          const chatContainer = chatElem ? chatElem.closest('#chat-container') || chatElem : null;
          if (chatContainer && !chatContainer.hasAttribute000('tyt-chat-container')) {
            for (const p of document.querySelectorAll('[tyt-chat-container]')) {
              p.removeAttribute000('[tyt-chat-container]');
            }
            chatContainer.setAttribute111('tyt-chat-container', '');
          }
          const cnt = insp(hostElement);
          const q = cnt.__urlChangedAsyncT688__;
          const p = (cnt.__urlChangedAsyncT689__ = new PromiseExternal());
          setTimeout_(() => {
            if (p !== cnt.__urlChangedAsyncT689__) return;
            if (cnt.isAttached === true && hostElement.isConnected === true) {
              p.resolve();
              if (q === cnt.__urlChangedAsyncT688__) {
                cnt.urlChanged();
              }
            }
          }, 320);
          Promise.resolve(lockSet['layoutFixLock']).then(layoutFix);
        } else {
          console.log('Issue found in ytd-live-chat-frame::attached', chatElem, hostElement);
        }
      },

      'ytd-live-chat-frame::detached': hostElement => {
        // if (inPageRearrange) return;
        DEBUG_5084 && console.log(5084, 'ytd-live-chat-frame::detached');

        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        console.log('ytd-live-chat-frame::detached');
        if (hostElement.hasAttribute000('tyt-active-chat-frame')) {
          aoChat.disconnect();
          aoChat.takeRecords();
          hostElement.removeAttribute000('tyt-active-chat-frame');
          elements.chat = null;

          const ytdFlexyElm = elements.flexy;
          if (ytdFlexyElm) {
            ytdFlexyElm.removeAttribute000('tyt-chat-collapsed');
            ytdFlexyElm.setAttribute111('tyt-chat', '');
          }
        }
      },

      'ytd-engagement-panel-section-list-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }
        makeInitAttached('ytd-engagement-panel-section-list-renderer');
      },

      'ytd-engagement-panel-section-list-renderer::bindTarget': hostElement => {
        if (
          hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer[target-id][visibility]'
          )
        ) {
          hostElement.setAttribute111('tyt-egm-panel', '');
          Promise.resolve(lockSet['updateEgmPanelsLock']).then(updateEgmPanels).catch(console.warn);
          aoEgmPanels.observe(hostElement, {
            attributes: true,
            attributeFilter: ['visibility', 'hidden'],
          });

          // console.log(5094, 2, 'ytd-engagement-panel-section-list-renderer::attached', hostElement);
        }
      },

      'ytd-engagement-panel-section-list-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-engagement-panel-section-list-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;
        // console.log('ytd-engagement-panel-section-list-renderer::attached', hostElement)
        // console.log(5094, 1, 'ytd-engagement-panel-section-list-renderer::attached', hostElement);

        if (
          !hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer'
          )
        ) {
          return;
        }

        if (hostElement.hasAttribute000('target-id') && hostElement.hasAttribute000('visibility')) {
          Promise.resolve(hostElement)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(console.warn);
        } else {
          hostElement.setAttribute000('tyt-egm-panel-jclmd', '');
          moEgmPanelReady.observe(hostElement, {
            attributes: true,
            attributeFilter: ['visibility', 'target-id'],
          });
        }
      },

      'ytd-engagement-panel-section-list-renderer::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-engagement-panel-section-list-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
        if (hostElement.hasAttribute000('tyt-egm-panel')) {
          hostElement.removeAttribute000('tyt-egm-panel');
          Promise.resolve(lockSet['updateEgmPanelsLock']).then(updateEgmPanels).catch(console.warn);
        } else if (hostElement.hasAttribute000('tyt-egm-panel-jclmd')) {
          hostElement.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
        }
      },

      'ytd-watch-metadata::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-metadata');
      },

      'ytd-watch-metadata::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-watch-metadata::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;

        if (plugin.fullChannelNameOnHover.activated) {
          plugin.fullChannelNameOnHover.onNavigateFinish();
        }
      },

      'ytd-watch-metadata::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-watch-metadata::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
      },

      'ytd-playlist-panel-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::attached'])
                .catch(console.warn);
            }
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange) {
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::detached'])
                .catch(console.warn);
            }
            return this.detached498();
          };
        }

        makeInitAttached('ytd-playlist-panel-renderer');
      },

      'ytd-playlist-panel-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-playlist-panel-renderer::attached');
        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_) ||
          !(hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        ) {
          return;
        }
        if (hostElement.isConnected !== true) return;
        // if (hostElement.__connectedFlg__ !== 4) return;
        // hostElement.__connectedFlg__ = 5;

        elements.playlist = hostElement;

        aoPlayList.observe(hostElement, {
          attributes: true,
          attributeFilter: ['hidden', 'collapsed', 'attr-1y6nu'],
        });
        hostElement.incAttribute111('attr-1y6nu');
      },

      'ytd-playlist-panel-renderer::detached': hostElement => {
        // if (inPageRearrange) return;

        DEBUG_5084 && console.log(5084, 'ytd-playlist-panel-renderer::detached');
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        // if (hostElement.__connectedFlg__ !== 8) return;
        // hostElement.__connectedFlg__ = 9;
      },

      _yt_playerProvided: () => {
        mLoaded.flag |= 4;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());
      },
      relatedElementProvided: target => {
        if (target.closest('[hidden]')) return;
        elements.related = target;
        console.log('relatedElementProvided');
        videosElementProvidedPromise.resolve();
      },
      onceInfoExpanderElementProvidedPromised: () => {
        console.log('hide-default-text-inline-expander');
        const ytdFlexyElm = elements.flexy;
        if (ytdFlexyElm) {
          ytdFlexyElm.setAttribute111('hide-default-text-inline-expander', '');
        }
      },

      refreshSecondaryInner: lockId => {
        if (lockGet['refreshSecondaryInnerLock'] !== lockId) return;
        /*
                   
                        ytd-watch-flexy:not([panels-beside-player]):not([fixed-panels]) #panels-full-bleed-container.ytd-watch-flexy{
                            display: none;}
                   
                  #player-full-bleed-container.ytd-watch-flexy{
                      position: relative;
                      flex: 1;}
                   
                        */

        const ytdFlexyElm = elements.flexy;
        // if(ytdFlexyElm && ytdFlexyElm.matches('ytd-watch-flexy[fixed-panels][theater]')){
        //   // ytdFlexyElm.fixedPanels = true;
        //   ytdFlexyElm.removeAttribute000('fixed-panels');
        // }

        if (
          ytdFlexyElm &&
          ytdFlexyElm.matches(
            'ytd-watch-flexy[theater][full-bleed-player]:not([full-bleed-no-max-width-columns])'
          )
        ) {
          // ytdFlexyElm.fullBleedNoMaxWidthColumns = true;
          ytdFlexyElm.setAttribute111('full-bleed-no-max-width-columns', '');
        }

        const related = elements.related;
        if (related && related.isConnected && !related.closest('#right-tabs #tab-videos')) {
          document.querySelector('#tab-videos').assignChildren111(null, related, null);
        }
        const infoExpander = elements.infoExpander;
        if (
          infoExpander &&
          infoExpander.isConnected &&
          !infoExpander.closest('#right-tabs #tab-info')
        ) {
          document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
        } else {
          // if (infoExpander && ytdFlexyElm && shouldFixInfo) {
          //   shouldFixInfo = false;
          //   Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
          // }
        }

        const commentsArea = elements.comments;
        if (commentsArea) {
          const isConnected = commentsArea.isConnected;
          if (isConnected && !commentsArea.closest('#right-tabs #tab-comments')) {
            const tab = document.querySelector('#tab-comments');
            tab.assignChildren111(null, commentsArea, null);
          } else {
            // if (!isConnected || tab.classList.contains('tab-content-hidden')) removeKeepCommentsScroller();
          }
        }
      },

      'yt-navigate-finish': _evt => {
        const ytdAppElm = document.querySelector(
          'ytd-page-manager#page-manager.style-scope.ytd-app'
        );
        const ytdAppCnt = insp(ytdAppElm);
        pageType = ytdAppCnt ? (ytdAppCnt.data || 0).page : null;

        if (!document.querySelector('ytd-watch-flexy #player')) return;
        // shouldFixInfo = true;
        // console.log('yt-navigate-finish')
        const flexyArr = [...document.querySelectorAll('ytd-watch-flexy')].filter(
          e => !e.closest('[hidden]') && e.querySelector('#player')
        );
        if (flexyArr.length === 1) {
          // const lockId = lockSet['yt-navigate-finish-videos'];
          elements.flexy = flexyArr[0];
          if (isRightTabsInserted) {
            Promise.resolve(lockSet['refreshSecondaryInnerLock'])
              .then(eventMap['refreshSecondaryInner'])
              .catch(console.warn);
            Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
              .then(removeKeepCommentsScroller)
              .catch(console.warn);
          } else {
            navigateFinishedPromise.resolve();
            if (plugin.minibrowser.toUse) plugin.minibrowser.activate();
            if (plugin.autoExpandInfoDesc.toUse) plugin.autoExpandInfoDesc.activate();
            if (plugin.fullChannelNameOnHover.toUse) plugin.fullChannelNameOnHover.activate();
          }
          const chat = elements.chat;
          if (chat instanceof Element) {
            chat.setAttribute111('tyt-active-chat-frame', 'CF'); // chat and flexy ready
          }
          const infoExpander = elements.infoExpander;
          if (infoExpander && infoExpander.closest('#right-tabs')) {
            Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
          }
          Promise.resolve(lockSet['layoutFixLock']).then(layoutFix);
          if (plugin.fullChannelNameOnHover.activated) {
            plugin.fullChannelNameOnHover.onNavigateFinish();
          }
        }
      },

      onceInsertRightTabs: () => {
        // if(lockId !== lockGet['yt-navigate-finish-videos']) return;
        const related = elements.related;
        let rightTabs = document.querySelector('#right-tabs');
        if (!document.querySelector('#right-tabs') && related) {
          getLangForPage();
          const docTmp = document.createElement('template');
          docTmp.innerHTML = createHTML(getTabsHTML());
          const newElm = docTmp.content.firstElementChild;
          if (newElm !== null) {
            inPageRearrange = true;
            related.parentNode.insertBefore000(newElm, related);
            inPageRearrange = false;
          }
          rightTabs = newElm;
          rightTabs
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.add('tab-btn-hidden');

          const secondaryWrapper = document.createElement('secondary-wrapper');
          secondaryWrapper.classList.add('tabview-secondary-wrapper');
          const secondaryInner = document.querySelector(
            '#secondary-inner.style-scope.ytd-watch-flexy'
          );

          inPageRearrange = true;
          secondaryWrapper.replaceChildren000(...secondaryInner.childNodes);
          secondaryInner.insertBefore000(secondaryWrapper, secondaryInner.firstChild);
          inPageRearrange = false;

          rightTabs
            .querySelector('#material-tabs')
            .addEventListener('click', eventMap['tabs-btn-click'], true);

          inPageRearrange = true;
          if (!rightTabs.closest('secondary-wrapper')) secondaryWrapper.appendChild000(rightTabs);
          inPageRearrange = false;
        }
        if (rightTabs) {
          isRightTabsInserted = true;
          const ioTabBtns = new IntersectionObserver(
            entries => {
              for (const entry of entries) {
                const rect = entry.boundingClientRect;
                entry.target.classList.toggle('tab-btn-visible', rect.width && rect.height);
              }
            },
            { rootMargin: '0px' }
          );
          for (const btn of document.querySelectorAll('.tab-btn[tyt-tab-content]')) {
            ioTabBtns.observe(btn);
          }
          if (!related.closest('#right-tabs')) {
            document.querySelector('#tab-videos').assignChildren111(null, related, null);
          }
          const infoExpander = elements.infoExpander;
          if (infoExpander && !infoExpander.closest('#right-tabs')) {
            document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
          }
          const commentsArea = elements.comments;
          if (commentsArea && !commentsArea.closest('#right-tabs')) {
            document.querySelector('#tab-comments').assignChildren111(null, commentsArea, null);
          }
          rightTabsProvidedPromise.resolve();
          roRightTabs.disconnect();
          roRightTabs.observe(rightTabs);
          const ytdFlexyElm = elements.flexy;
          const aoFlexy = new MutationObserver(eventMap['aoFlexyFn']);
          aoFlexy.observe(ytdFlexyElm, { attributes: true });
          // Promise.resolve(lockSet['tabsStatusCorrectionLock']).then(eventMap['tabsStatusCorrection']).catch(console.warn);

          Promise.resolve(lockSet['fixInitialTabStateLock'])
            .then(eventMap['fixInitialTabStateFn'])
            .catch(console.warn);

          ytdFlexyElm.incAttribute111('attr-7qlsy'); // tabsStatusCorrectionLock and video-id
        }
      },

      aoFlexyFn: () => {
        Promise.resolve(lockSet['checkCommentsShouldBeHiddenLock'])
          .then(eventMap['checkCommentsShouldBeHidden'])
          .catch(console.warn);

        Promise.resolve(lockSet['refreshSecondaryInnerLock'])
          .then(eventMap['refreshSecondaryInner'])
          .catch(console.warn);

        Promise.resolve(lockSet['tabsStatusCorrectionLock'])
          .then(eventMap['tabsStatusCorrection'])
          .catch(console.warn);

        const videoId = getCurrentVideoId();
        if (videoId !== tmpLastVideoId) {
          tmpLastVideoId = videoId;
          Promise.resolve(lockSet['updateOnVideoIdChangedLock'])
            .then(eventMap['updateOnVideoIdChanged'])
            .catch(console.warn);
        }
      },

      twoColumnChanged10: lockId => {
        if (lockId !== lockGet['twoColumnChanged10Lock']) return;
        for (const continuation of document.querySelectorAll(
          '#tab-videos ytd-watch-next-secondary-results-renderer ytd-continuation-item-renderer'
        )) {
          if (continuation.closest('[hidden]')) continue;
          const cnt = insp(continuation);
          if (typeof cnt.showButton === 'boolean') {
            if (cnt.showButton === false) continue;
            cnt.showButton = false;
            const behavior = cnt.ytRendererBehavior || cnt;
            if (typeof behavior.invalidate === 'function') {
              behavior.invalidate(!1);
            }
          }
        }
      },

      tabsStatusCorrection: lockId => {
        if (lockId !== lockGet['tabsStatusCorrectionLock']) return;
        const ytdFlexyElm = elements.flexy;
        if (!ytdFlexyElm) return;
        const p = tabAStatus;
        const q = calculationFn(p, 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 4096);

        let resetForPanelDisappeared = false;
        let special = 0;
        let actioned = false;
        if (plugin['external.ytlstm'].activated) {
          if (q & 64) {
            // ignore fullscreen
          } else if (
            (p & (1 | 2 | 4 | 8 | 16 | 4096)) === (1 | 0 | 0 | 8 | 16 | 4096) &&
            (q & (1 | 2 | 4 | 8 | 16 | 4096)) === (1 | 0 | 4 | 0 | 16 | 4096)
          ) {
            special = 3;
          } else if (
            (q & (1 | 16)) === (1 | 16) &&
            document.querySelector('[data-ytlstm-theater-mode]')
          ) {
            special = 1;
          } else if (
            (q & (1 | 8 | 16)) === (1 | 8 | 16) &&
            document.querySelector('[is-two-columns_][theater][tyt-chat="+"]')
          ) {
            special = 2;
          }
        }
        if (special) {
          // special
        } else if ((p & 128) === 0 && (q & 128) === 128) {
          lastPanel = 'playlist';
        } else if ((p & 8) === 0 && (q & 8) === 8) {
          lastPanel = 'chat';
        } else if (
          (((p & 4) === 4 && (q & (4 | 8)) === (0 | 0)) ||
            ((p & 8) === 8 && (q & (4 | 8)) === (0 | 0))) &&
          lastPanel === 'chat'
        ) {
          // 24 -> 16 = -8; 'd'
          lastPanel = lastTab || '';
          resetForPanelDisappeared = true;
        } else if ((p & (4 | 8)) === 8 && (q & (4 | 8)) === 4 && lastPanel === 'chat') {
          // click close
          lastPanel = lastTab || '';
          resetForPanelDisappeared = true;
        } else if ((p & 128) === 128 && (q & 128) === 0 && lastPanel === 'playlist') {
          lastPanel = lastTab || '';
          resetForPanelDisappeared = true;
        }
        tabAStatus = q;

        if (special) {
          if (special === 1) {
            if (ytdFlexyElm.getAttribute('tyt-chat') !== '+') {
              ytBtnExpandChat();
            }
            if (ytdFlexyElm.getAttribute('tyt-tab')) {
              switchToTab(null);
            }
          } else if (special === 2) {
            ytBtnCollapseChat();
          } else if (special === 3) {
            ytBtnCancelTheater();
            if (lastTab) {
              switchToTab(lastTab);
            }
          }
          return;
        }

        let bFixForResizedTab = false;

        if ((q ^ 2) === 2 && bFixForResizedTabLater) {
          bFixForResizedTab = true;
        }

        if (((p & 16) === 16) & ((q & 16) === 0)) {
          Promise.resolve(lockSet['twoColumnChanged10Lock'])
            .then(eventMap['twoColumnChanged10'])
            .catch(console.warn);
        }

        if (((p & 2) === 2) ^ ((q & 2) === 2) && (q & 2) === 2) {
          bFixForResizedTab = true;
        }

        // p->q +2
        if ((p & 2) === 0 && (q & 2) === 2 && (p & 128) === 128 && (q & 128) === 128) {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
          actioned = true;
        }

        // p->q +8
        if (
          (p & (8 | 128)) === (0 | 128) &&
          (q & (8 | 128)) === (8 | 128) &&
          lastPanel === 'chat'
        ) {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
          actioned = true;
        }

        if (
          (p & (1 | 2 | 4 | 8 | 16 | 32 | 64 | 128)) === (1 | 2 | 0 | 8 | 16) &&
          (q & (1 | 2 | 4 | 8 | 16 | 32 | 64 | 128)) === (0 | 2 | 0 | 8 | 16)
        ) {
          // external.ytlstm case
          lastPanel = lastTab || '';
          ytBtnCollapseChat();
          actioned = true;
        }

        // p->q +128
        if (
          (p & (2 | 128)) === (2 | 0) &&
          (q & (2 | 128)) === (2 | 128) &&
          lastPanel === 'playlist'
        ) {
          switchToTab(null);
          actioned = true;
        }

        // p->q +128
        if (
          (p & (8 | 128)) === (8 | 0) &&
          (q & (8 | 128)) === (8 | 128) &&
          lastPanel === 'playlist'
        ) {
          lastPanel = lastTab || '';
          ytBtnCollapseChat();
          actioned = true;
        }

        // p->q +128
        if ((p & (1 | 16 | 128)) === (1 | 16) && (q & (1 | 16 | 128)) === (1 | 16 | 128)) {
          ytBtnCancelTheater();
          actioned = true;
        }

        // p->q +1
        if ((p & (1 | 16 | 128)) === (16 | 128) && (q & (1 | 16 | 128)) === (1 | 16 | 128)) {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
          actioned = true;
        }

        if ((q & 64) === 64) {
          actioned = false;
        } else if ((p & 64) === 64 && (q & 64) === 0) {
          // p->q -64

          if ((q & 32) === 32) {
            ytBtnCloseEngagementPanels();
          }

          if ((q & (2 | 8)) === (2 | 8)) {
            if (lastPanel === 'chat') {
              switchToTab(null);
              actioned = true;
            } else if (lastPanel) {
              ytBtnCollapseChat();
              actioned = true;
            }
          }
        } else if (
          (p & (1 | 2 | 8 | 16 | 32)) === (1 | 0 | 0 | 16 | 0) &&
          (q & (1 | 2 | 8 | 16 | 32)) === (1 | 0 | 8 | 16 | 0)
        ) {
          // p->q +8
          ytBtnCancelTheater();
          actioned = true;
        } else if (
          (p & (1 | 16 | 32)) === (0 | 16 | 0) &&
          (q & (1 | 16 | 32)) === (0 | 16 | 32) &&
          (q & (2 | 8)) > 0
        ) {
          // p->q +32
          if (q & 2) {
            switchToTab(null);
            actioned = true;
          }
          if (q & 8) {
            ytBtnCollapseChat();
            actioned = true;
          }
        } else if (
          (p & (1 | 16 | 8 | 2)) === (16 | 8) &&
          (q & (1 | 16 | 8 | 2)) === 16 &&
          (q & 128) === 0
        ) {
          // p->q -8
          if (lastTab) {
            switchToTab(lastTab);
            actioned = true;
          }
        } else if ((p & 1) === 0 && (q & 1) === 1) {
          // p->q +1
          if ((q & 32) === 32) {
            ytBtnCloseEngagementPanels();
          }
          if ((p & 9) === 8 && (q & 9) === 9) {
            ytBtnCollapseChat();
          }
          switchToTab(null);
          actioned = true;
        } else if ((p & 3) === 1 && (q & 3) === 3) {
          // p->q +2
          ytBtnCancelTheater();
          actioned = true;
        } else if ((p & 10) === 2 && (q & 10) === 10) {
          // p->q +8
          switchToTab(null);
          actioned = true;
        } else if ((p & (8 | 32)) === (0 | 32) && (q & (8 | 32)) === (8 | 32)) {
          // p->q +8
          ytBtnCloseEngagementPanels();
          actioned = true;
        } else if ((p & (2 | 32)) === (0 | 32) && (q & (2 | 32)) === (2 | 32)) {
          // p->q +2
          ytBtnCloseEngagementPanels();
          actioned = true;
        } else if ((p & (2 | 8)) === (0 | 8) && (q & (2 | 8)) === (2 | 8)) {
          // p->q +2
          ytBtnCollapseChat();
          actioned = true;
          // if( lastPanel && (p & (1|16) === 16)  && (q & (1 | 16 | 8 | 2)) === (16) ){
          //   switchToTab(lastTab)
          //   actioned = true;
          // }
        } else if ((p & 1) === 1 && (q & (1 | 32)) === (0 | 0)) {
          // p->q -1
          if (lastPanel === 'chat') {
            ytBtnExpandChat();
            actioned = true;
          } else if (lastPanel === lastTab && lastTab) {
            switchToTab(lastTab);
            actioned = true;
          }
        }

        // 24 20
        // 8 16   4 16

        if (!actioned && (q & 128) === 128) {
          lastPanel = 'playlist';
          if ((q & 2) === 2) {
            switchToTab(null);
            actioned = true;
          }
        }

        let shouldDoAutoFix = false;

        if ((p & 2) === 2 && (q & (2 | 128)) === (0 | 128)) {
          // p->q -2
        } else if ((p & 8) === 8 && (q & (8 | 128)) === (0 | 128)) {
          // p->q -8
        } else if (
          !actioned &&
          (p & (1 | 16)) === 16 &&
          (q & (1 | 16 | 8 | 2 | 32 | 64)) === (16 | 0 | 0)
        ) {
          shouldDoAutoFix = true;
        } else if ((q & (1 | 2 | 4 | 8 | 16 | 32 | 64 | 128)) === (4 | 16)) {
          shouldDoAutoFix = true;
        }

        if (shouldDoAutoFix) {
          console.log(388, 'd');
          if (lastPanel === 'chat') {
            console.log(388, 'd1c');
            ytBtnExpandChat();
            actioned = true;
          } else if (lastPanel === 'playlist') {
            console.log(388, 'd1p');
            ytBtnOpenPlaylist();
            actioned = true;
          } else if (lastTab) {
            console.log(388, 'd2t');
            switchToTab(lastTab);
            actioned = true;
          } else if (resetForPanelDisappeared) {
            // if lastTab is undefined
            console.log(388, 'd2d');
            Promise.resolve(lockSet['fixInitialTabStateLock'])
              .then(eventMap['fixInitialTabStateFn'])
              .catch(console.warn);
            actioned = true;
          }
        }

        if (bFixForResizedTab) {
          bFixForResizedTabLater = false;
          Promise.resolve(0).then(eventMap['fixForTabDisplay']).catch(console.warn);
        }

        if (((p & 16) === 16) ^ ((q & 16) === 16)) {
          Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
          Promise.resolve(lockSet['removeKeepCommentsScrollerLock'])
            .then(removeKeepCommentsScroller)
            .catch(console.warn);
          Promise.resolve(lockSet['layoutFixLock']).then(layoutFix).catch(console.warn);
        }
      },

      updateOnVideoIdChanged: lockId => {
        if (lockId !== lockGet['updateOnVideoIdChangedLock']) return;
        const videoId = tmpLastVideoId;
        if (!videoId) return;

        const bodyRenderer = elements.infoExpanderRendererBack;
        const bodyRendererNew = elements.infoExpanderRendererFront;

        if (bodyRendererNew && bodyRenderer) {
          insp(bodyRendererNew).data = insp(bodyRenderer).data;
          // if ((bodyRendererNew.hasAttribute('hidden') ? 1 : 0) ^ (bodyRenderer.hasAttribute('hidden') ? 1 : 0)) {
          //   if (bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
          //   else bodyRendererNew.removeAttribute('hidden');
          // }
        }

        Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(console.warn);
      },

      fixInitialTabStateFn: async lockId => {
        // console.log('fixInitialTabStateFn 0a');
        if (lockGet['fixInitialTabStateLock'] !== lockId) return;
        // console.log('fixInitialTabStateFn 0b');
        const delayTime = fixInitialTabStateK > 0 ? 200 : 1;
        await delayPn(delayTime);
        if (lockGet['fixInitialTabStateLock'] !== lockId) return;
        // console.log('fixInitialTabStateFn 0c');
        const kTab = document.querySelector('[tyt-tab]');
        const qTab =
          !kTab || kTab.getAttribute('tyt-tab') === ''
            ? checkElementExist('ytd-watch-flexy[is-two-columns_]', '[hidden]')
            : null;
        if (checkElementExist('ytd-playlist-panel-renderer#playlist', '[hidden], [collapsed]')) {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1p');
          switchToTab(null);
        } else if (checkElementExist('ytd-live-chat-frame#chat', '[hidden], [collapsed]')) {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1a');
          switchToTab(null);
          if (checkElementExist('ytd-watch-flexy[theater]', '[hidden]')) {
            ytBtnCollapseChat();
          }
        } else if (qTab) {
          const hasTheater = qTab.hasAttribute('theater');
          if (!hasTheater) {
            DEBUG_5085 && console.log('fixInitialTabStateFn 1b');
            const btn0 = document.querySelector('.tab-btn-visible'); // or default button
            if (btn0) {
              switchToTab(btn0);
            } else {
              switchToTab(null);
            }
          } else {
            DEBUG_5085 && console.log('fixInitialTabStateFn 1c');
            switchToTab(null);
          }
        } else {
          DEBUG_5085 && console.log('fixInitialTabStateFn 1z');
        }
        // console.log('fixInitialTabStateFn 0d');
        fixInitialTabStateK++;
      },

      'tabs-btn-click': evt => {
        const target = evt.target;
        if (
          target instanceof HTMLElement_ &&
          target.classList.contains('tab-btn') &&
          target.hasAttribute000('tyt-tab-content')
        ) {
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();

          const activeLink = target;

          switchToTab(activeLink);
        }
      },
    };

    Promise.all([videosElementProvidedPromise, navigateFinishedPromise])
      .then(eventMap['onceInsertRightTabs'])
      .catch(console.warn);
    Promise.all([navigateFinishedPromise, infoExpanderElementProvidedPromise])
      .then(eventMap['onceInfoExpanderElementProvidedPromised'])
      .catch(console.warn);

    const isCustomElementsProvided =
      typeof customElements !== 'undefined' &&
      typeof (customElements || 0).whenDefined === 'function';

    const promiseForCustomYtElementsReady = isCustomElementsProvided
      ? Promise.resolve(0)
      : new Promise(callback => {
          const EVENT_KEY_ON_REGISTRY_READY = 'ytI-ce-registry-created';
          if (typeof customElements === 'undefined') {
            if (!('__CE_registry' in document)) {
              // https://github.com/webcomponents/polyfills/
              Object.defineProperty(document, '__CE_registry', {
                get() {
                  // return undefined
                },
                set(nv) {
                  if (typeof nv == 'object') {
                    delete this.__CE_registry;
                    this.__CE_registry = nv;
                    this.dispatchEvent(new CustomEvent(EVENT_KEY_ON_REGISTRY_READY));
                  }
                  return true;
                },
                enumerable: false,
                configurable: true,
              });
            }
            let eventHandler = _evt => {
              document.removeEventListener(EVENT_KEY_ON_REGISTRY_READY, eventHandler, false);
              const f = callback;
              callback = null;
              eventHandler = null;
              f();
            };
            document.addEventListener(EVENT_KEY_ON_REGISTRY_READY, eventHandler, false);
          } else {
            callback();
          }
        });

    // eslint-disable-next-line no-unused-vars
    const _retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
      } catch (e) {
        console.warn(e);
      }
    };

    const retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
        const dummy = document.querySelector(nodeName) || document.createElement(nodeName);
        const cProto = insp(dummy).constructor.prototype;
        return cProto;
      } catch (e) {
        console.warn(e);
      }
    };

    const moOverallRes = {
      _yt_playerProvided: () => (window || 0)._yt_player || 0 || 0,
    };

    let promiseWaitNext = null;
    const moOverall = new MutationObserver(() => {
      if (promiseWaitNext) {
        promiseWaitNext.resolve();
        promiseWaitNext = null;
      }

      if (typeof moOverallRes._yt_playerProvided === 'function') {
        const r = moOverallRes._yt_playerProvided();
        if (r) {
          moOverallRes._yt_playerProvided = r;
          eventMap._yt_playerProvided();
        }
      }
    });

    moOverall.observe(document, { subtree: true, childList: true });

    const moEgmPanelReady = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!target.hasAttribute000('tyt-egm-panel-jclmd')) continue;
        if (target.hasAttribute000('target-id') && target.hasAttribute000('visibility')) {
          target.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
          Promise.resolve(target)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(console.warn);
        }
      }
    });

    const moEgmPanelReadyClearFn = () => {
      if (document.querySelector('[tyt-egm-panel-jclmd]') === null) {
        moEgmPanelReady.takeRecords();
        moEgmPanelReady.disconnect();
      }
    };

    document.addEventListener('yt-navigate-finish', eventMap['yt-navigate-finish'], false);

    document.addEventListener(
      'animationstart',
      evt => {
        const f = eventMap[evt.animationName];
        if (typeof f === 'function') f(evt.target);
      },
      capturePassive
    );

    // console.log('hi122')

    mLoaded.flag |= 1;
    document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());

    promiseForCustomYtElementsReady.then(eventMap['ceHack']).catch(console.warn);

    // eslint-disable-next-line no-unused-vars
    executionFinished = 1;
  } catch (e) {
    console.log('error 0xF491');
    console.error(e);
  }
};
const styles = {
  main: `
@keyframes relatedElementProvided{0%{background-position-x:3px;}100%{background-position-x:4px;}}
html[tabview-loaded="icp"] #related.ytd-watch-flexy{animation:relatedElementProvided 1ms linear 0s 1 normal forwards;}
html[tabview-loaded="icp"] #right-tabs #related.ytd-watch-flexy,html[tabview-loaded="icp"] [hidden] #related.ytd-watch-flexy,html[tabview-loaded="icp"] #right-tabs ytd-expander#expander,html[tabview-loaded="icp"] [hidden] ytd-expander#expander,html[tabview-loaded="icp"] ytd-comments ytd-expander#expander{animation:initial;}
#secondary.ytd-watch-flexy{position:relative;}
#secondary-inner.style-scope.ytd-watch-flexy{height:100%;}
#secondary-inner secondary-wrapper{display:flex;flex-direction:column;flex-wrap:nowrap;box-sizing:border-box;padding:0;margin:0;border:0;height:100%;max-height:calc(100vh - var(--ytd-toolbar-height,56px));position:absolute;top:0;right:0;left:0;contain:strict;padding:var(--ytd-margin-6x) var(--ytd-margin-6x) var(--ytd-margin-6x) 0;}
#right-tabs{position:relative;display:flex;padding:0;margin:0;flex-grow:1;flex-direction:column;}
[tyt-tab=""] #right-tabs{flex-grow:0;}
[tyt-tab=""] #right-tabs .tab-content{border:0;}
#right-tabs .tab-content{flex-grow:1;}
ytd-watch-flexy[hide-default-text-inline-expander] #primary.style-scope.ytd-watch-flexy ytd-text-inline-expander{display:none;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden{--comment-pre-load-sizing:90px;visibility:collapse;z-index:-1;position:fixed!important;left:2px;top:2px;width:var(--comment-pre-load-sizing)!important;height:var(--comment-pre-load-sizing)!important;display:block!important;pointer-events:none!important;overflow:hidden;contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments>ytd-item-section-renderer#sections{display:block!important;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments>ytd-item-section-renderer#sections>#contents{display:flex!important;flex-direction:row;gap:60px;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents{--comment-pre-load-display:none;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*:only-of-type,ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*:last-child{--comment-pre-load-display:block;}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents>*{display:var(--comment-pre-load-display)!important;}
#right-tabs #material-tabs{position:relative;display:flex;padding:0;border:1px solid var(--ytd-searchbox-legacy-border-color);overflow:hidden;}
[tyt-tab] #right-tabs #material-tabs{border-radius:12px;}
[tyt-tab^="#"] #right-tabs #material-tabs{border-radius:12px 12px 0 0;}
ytd-watch-flexy:not([is-two-columns_]) #right-tabs #material-tabs{outline:0;}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content]>*{pointer-events:none;}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content]>.font-size-right{pointer-events:initial;display:none;}
ytd-watch-flexy #right-tabs .tab-content{padding:0;box-sizing:border-box;display:block;border:1px solid var(--ytd-searchbox-legacy-border-color);border-top:0;position:relative;top:0;display:flex;flex-direction:row;overflow:hidden;border-radius:0 0 12px 12px;}
ytd-watch-flexy:not([is-two-columns_]) #right-tabs .tab-content{height:100%;}
ytd-watch-flexy #right-tabs .tab-content-cld{box-sizing:border-box;position:relative;display:block;width:100%;overflow:auto;--tab-content-padding:var(--ytd-margin-4x);padding:var(--tab-content-padding);contain:layout paint;}
.tab-content-cld,#right-tabs,.tab-content{transition:none;animation:none;}
#right-tabs #emojis.ytd-commentbox{inset:auto 0 auto 0;width:auto;}
ytd-watch-flexy[is-two-columns_] #right-tabs .tab-content-cld{height:100%;width:100%;contain:size layout paint style;position:absolute;}
ytd-watch-flexy #right-tabs .tab-content-cld.tab-content-hidden{display:none;width:100%;contain:size layout paint style;}
@supports (color:var(--tabview-tab-btn-define)){
ytd-watch-flexy #right-tabs .tab-btn{background:var(--yt-spec-general-background-a);}
html{--tyt-tab-btn-flex-grow:1;--tyt-tab-btn-flex-basis:0%;--tyt-tab-bar-color-1-def:#ff4533;--tyt-tab-bar-color-2-def:var(--yt-brand-light-red);--tyt-tab-bar-color-1:var(--main-color,var(--tyt-tab-bar-color-1-def));--tyt-tab-bar-color-2:var(--main-color,var(--tyt-tab-bar-color-2-def));}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]{flex:var(--tyt-tab-btn-flex-grow) 1 var(--tyt-tab-btn-flex-basis);position:relative;display:inline-block;text-decoration:none;text-transform:uppercase;--tyt-tab-btn-color:var(--yt-spec-text-secondary);color:var(--tyt-tab-btn-color);text-align:center;padding:14px 8px 10px;border:0;border-bottom:4px solid transparent;font-weight:500;font-size:12px;line-height:18px;cursor:pointer;transition:border 200ms linear 100ms;background-color:var(--ytd-searchbox-legacy-button-color);text-transform:var(--yt-button-text-transform,inherit);user-select:none!important;overflow:hidden;white-space:nowrap;text-overflow:clip;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg{height:18px;padding-right:0;vertical-align:bottom;opacity:.5;margin-right:0;color:var(--yt-button-color,inherit);fill:var(--iron-icon-fill-color,currentcolor);stroke:var(--iron-icon-stroke-color,none);pointer-events:none;}
ytd-watch-flexy #right-tabs .tab-btn{--tabview-btn-txt-ml:8px;}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]{--tabview-btn-txt-ml:0;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg+span{margin-left:var(--tabview-btn-txt-ml);}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active{font-weight:500;outline:0;--tyt-tab-btn-color:var(--yt-spec-text-primary);background-color:var(--ytd-searchbox-legacy-button-focus-color);border-bottom:2px var(--tyt-tab-bar-color-2) solid;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active svg{opacity:.9;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover{background-color:var(--ytd-searchbox-legacy-button-hover-color);--tyt-tab-btn-color:var(--yt-spec-text-primary);}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover svg{opacity:.9;}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].tab-btn-hidden{display:none;}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"],ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]:hover{--tyt-tab-btn-color:var(--yt-spec-icon-disabled);}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"] span#tyt-cm-count:empty{display:none;}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{display:inline-block;width:4em;text-align:left;font-size:inherit;color:currentColor;transform:scaleX(.8);}
}
@supports (color:var(--tyt-cm-count-define)){
ytd-watch-flexy{--tyt-x-loading-content-letter-spacing:2px;}
html{--tabview-text-loading:"Loading";--tabview-text-fetching:"Fetching";--tabview-panel-loading:var(--tabview-text-loading);}
html:lang(ja){--tabview-text-loading:"読み込み中";--tabview-text-fetching:"フェッチ..";}
html:lang(ko){--tabview-text-loading:"로딩..";--tabview-text-fetching:"가져오기..";}
html:lang(zh-Hant){--tabview-text-loading:"載入中";--tabview-text-fetching:"擷取中";}
html:lang(zh-Hans){--tabview-text-loading:"加载中";--tabview-text-fetching:"抓取中";}
html:lang(ru){--tabview-text-loading:"Загрузка";--tabview-text-fetching:"Получение";}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{content:var(--tabview-text-loading);letter-spacing:var(--tyt-x-loading-content-letter-spacing);}
}
@supports (color:var(--tabview-font-size-btn-define)){
.font-size-right{display:inline-flex;flex-direction:column;position:absolute;right:0;top:0;bottom:0;width:16px;padding:4px 0;justify-content:space-evenly;align-content:space-evenly;pointer-events:none;}
html body ytd-watch-flexy.style-scope .font-size-btn{user-select:none!important;}
.font-size-btn{--tyt-font-size-btn-display:none;display:var(--tyt-font-size-btn-display,none);width:12px;height:12px;color:var(--yt-spec-text-secondary);background-color:var(--yt-spec-badge-chip-background);box-sizing:border-box;cursor:pointer;transform-origin:left top;margin:0;padding:0;position:relative;font-family:'Menlo','Lucida Console','Monaco','Consolas',monospace;line-height:100%;font-weight:900;transition:background-color 90ms linear,color 90ms linear;pointer-events:all;}
.font-size-btn:hover{background-color:var(--yt-spec-text-primary);color:var(--yt-spec-general-background-a);}
@supports (zoom:.5){
.tab-btn .font-size-btn{--tyt-font-size-btn-display:none;}
.tab-btn.active:hover .font-size-btn{--tyt-font-size-btn-display:inline-block;}
body ytd-watch-flexy:not([is-two-columns_]) #columns.ytd-watch-flexy{flex-direction:column;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy{display:block;width:100%;box-sizing:border-box;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper{padding-left:var(--ytd-margin-6x);contain:content;height:initial;}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper #right-tabs{overflow:auto;}
[tyt-chat="+"] { --tyt-chat-grow: 1;}
[tyt-chat="+"] secondary-wrapper>[tyt-chat-container]{flex-grow:var(--tyt-chat-grow);flex-shrink:0;display:flex;flex-direction:column;}
[tyt-chat="+"] secondary-wrapper>[tyt-chat-container]>#chat{flex-grow:var(--tyt-chat-grow);}
ytd-watch-flexy[is-two-columns_]:not([theater]) #columns.style-scope.ytd-watch-flexy{min-height:calc(100vh - var(--ytd-toolbar-height,56px));}
ytd-watch-flexy[is-two-columns_] ytd-live-chat-frame#chat{min-height:initial!important;height:initial!important;}
ytd-watch-flexy[tyt-tab^="#"]:not([is-two-columns_]):not([tyt-chat="+"]) #right-tabs{min-height:var(--ytd-watch-flexy-chat-max-height);}
body ytd-watch-flexy:not([is-two-columns_]) #chat.ytd-watch-flexy{margin-top:0;}
body ytd-watch-flexy:not([is-two-columns_]) ytd-watch-metadata.ytd-watch-flexy{margin-bottom:0;}
ytd-watch-metadata.ytd-watch-flexy ytd-metadata-row-container-renderer{display:none;}
#tab-info [show-expand-button] #expand-sizer.ytd-text-inline-expander{visibility:initial;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#left-arrow-container.ytd-video-description-infocards-section-renderer>#left-arrow,#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#right-arrow-container.ytd-video-description-infocards-section-renderer>#right-arrow{border:6px solid transparent;opacity:.65;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#left-arrow-container.ytd-video-description-infocards-section-renderer>#left-arrow:hover,#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>#right-arrow-container.ytd-video-description-infocards-section-renderer>#right-arrow:hover{opacity:1;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>div#left-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;left:-20px;top:0;z-index:-1;}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer>div#right-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;right:-20px;top:0;z-index:-1;}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy{flex-grow:1;flex-shrink:0;display:flex;flex-direction:column;}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]{height:initial;max-height:initial;min-height:initial;flex-grow:1;flex-shrink:0;display:flex;flex-direction:column;}
secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #body.ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #content.ytd-transcript-renderer:not(:empty){flex-grow:1;height:initial;max-height:initial;min-height:initial;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer{position:relative;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer>[panel-target-id]:only-child{contain:style size;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-list-renderer.ytd-transcript-search-panel-renderer{flex-grow:1;contain:strict;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer{contain:layout paint style;}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer>.segment{contain:layout paint style;}
body ytd-watch-flexy[theater] #secondary.ytd-watch-flexy{margin-top:var(--ytd-margin-3x);padding-top:0;}
body ytd-watch-flexy[theater] secondary-wrapper{margin-top:0;padding-top:0;}
body ytd-watch-flexy[theater] #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x);}
ytd-watch-flexy[theater] #right-tabs .tab-btn[tyt-tab-content]{padding:8px 4px 6px;border-bottom:0 solid transparent;}
ytd-watch-flexy[theater] #playlist.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x);}
ytd-watch-flexy[theater] ytd-playlist-panel-renderer[collapsible][collapsed] .header.ytd-playlist-panel-renderer{padding:6px 8px;}
#tab-comments ytd-comments#comments [field-of-cm-count]{margin-top:0;}
#tab-info>ytd-expandable-video-description-body-renderer{margin-bottom:var(--ytd-margin-3x);}
#tab-info [class]:last-child{margin-bottom:0;padding-bottom:0;}
#tab-info ytd-rich-metadata-row-renderer ytd-rich-metadata-renderer{max-width:initial;}
ytd-watch-flexy[is-two-columns_] secondary-wrapper #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-3x);}
ytd-watch-flexy[tyt-tab] tp-yt-paper-tooltip{white-space:nowrap;contain:content;}
ytd-watch-info-text tp-yt-paper-tooltip.style-scope.ytd-watch-info-text{margin-bottom:-300px;margin-top:-96px;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata{font-size:1.2rem;line-height:1.8rem;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata yt-animated-rolling-number{font-size:inherit;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata #info-container.style-scope.ytd-watch-info-text{align-items:center;}
ytd-watch-flexy[hide-default-text-inline-expander]{--tyt-bottom-watch-metadata-margin:6px;}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata>#description-inner.ytd-watch-metadata{margin:6px 12px;}
[hide-default-text-inline-expander] ytd-watch-metadata[title-headline-xs] h1.ytd-watch-metadata{font-size:1.8rem;}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-merch-shelf-renderer{padding:0;border:0;margin:0;}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-watch-metadata.ytd-watch-flexy{margin-bottom:6px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--horizontal .yt-video-attribute-view-model__link-container .yt-video-attribute-view-model__hero-section{flex-shrink:0;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model__overflow-menu{background:var(--yt-emoji-picker-category-background-color);border-radius:99px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-square.yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-height:128px;}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-width:128px;}
#tab-info ytd-reel-shelf-renderer #items.yt-horizontal-list-renderer ytd-reel-item-renderer.yt-horizontal-list-renderer{max-width:142px;}
ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #view-count.style-scope.ytd-watch-info-text,ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #date-text.style-scope.ytd-watch-info-text{align-items:center;}
ytd-watch-info-text:not([detailed]) #info.ytd-watch-info-text a.yt-simple-endpoint.yt-formatted-string{pointer-events:none;}
body ytd-app>ytd-popup-container>tp-yt-iron-dropdown>#contentWrapper>[slot="dropdown-content"]{backdrop-filter:none;}
#tab-info [tyt-clone-refresh-count]{overflow:visible!important;}
#tab-info #items.ytd-horizontal-card-list-renderer yt-video-attribute-view-model.ytd-horizontal-card-list-renderer{contain:layout;}
#tab-info #thumbnail-container.ytd-structured-description-channel-lockup-renderer,#tab-info ytd-media-lockup-renderer[is-compact] #thumbnail-container.ytd-media-lockup-renderer{flex-shrink:0;}
secondary-wrapper ytd-donation-unavailable-renderer{--ytd-margin-6x:var(--ytd-margin-2x);--ytd-margin-5x:var(--ytd-margin-2x);--ytd-margin-4x:var(--ytd-margin-2x);--ytd-margin-3x:var(--ytd-margin-2x);}
[tyt-no-less-btn] #less{display:none;}
.tyt-metadata-hover-resized #purchase-button,.tyt-metadata-hover-resized #sponsor-button,.tyt-metadata-hover-resized #analytics-button,.tyt-metadata-hover-resized #subscribe-button{display:none!important;}
.tyt-metadata-hover #upload-info{max-width:max-content;min-width:max-content;flex-basis:100vw;flex-shrink:0;}
.tyt-info-invisible{display:none;}
[tyt-playlist-expanded] secondary-wrapper>ytd-playlist-panel-renderer#playlist{overflow:auto;flex-shrink:1;flex-grow:1;max-height:unset!important;}
[tyt-playlist-expanded] secondary-wrapper>ytd-playlist-panel-renderer#playlist>#container{max-height:unset!important;}
secondary-wrapper ytd-playlist-panel-renderer{--ytd-margin-6x:var(--ytd-margin-3x);}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #playlist-thumbnail.style-scope.ytd-structured-description-playlist-lockup-renderer{max-width:100%;}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #lockup-container.ytd-structured-description-playlist-lockup-renderer{padding:1px;}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #thumbnail.ytd-structured-description-playlist-lockup-renderer{outline:1px solid rgba(127,127,127,.5);}
ytd-live-chat-frame#chat[collapsed] ytd-message-renderer~#show-hide-button.ytd-live-chat-frame>ytd-toggle-button-renderer.ytd-live-chat-frame{padding:0;}
ytd-watch-flexy{--tyt-bottom-watch-metadata-margin:12px;}
ytd-watch-flexy[rounded-info-panel],ytd-watch-flexy[rounded-player-large]{--tyt-rounded-a1:12px;}
#bottom-row.style-scope.ytd-watch-metadata .item.ytd-watch-metadata{margin-right:var(--tyt-bottom-watch-metadata-margin,12px);margin-top:var(--tyt-bottom-watch-metadata-margin,12px);}
#cinematics{contain:layout style size;}
ytd-watch-flexy[is-two-columns_]{contain:layout style;}
.yt-spec-touch-feedback-shape--touch-response .yt-spec-touch-feedback-shape__fill{background-color:transparent;}
/* plugin: external.ytlstm */
  body[data-ytlstm-theater-mode] #secondary-inner[class] > secondary-wrapper[class]:not(#chat-container):not(#chat) {display: flex !important;}  
  body[data-ytlstm-theater-mode] secondary-wrapper {all: unset;height: 100vh;}
  body[data-ytlstm-theater-mode] #right-tabs {display: none;}
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] [tyt-chat="+"] {--tyt-chat-grow: unset;}
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #columns.style-scope.ytd-watch-flexy,
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #secondary.style-scope.ytd-watch-flexy,
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #secondary-inner.style-scope.ytd-watch-flexy,
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] secondary-wrapper,
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #chat-container.style-scope,
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] [tyt-chat-container].style-scope {pointer-events: none;}
  body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #chat[class] {pointer-events: auto;}
  .playlist-items.ytd-playlist-panel-renderer {background-color: transparent !important;}
  `,
};
(async () => {
  const communicationKey = `ck-${Date.now()}-${Math.floor(Math.random() * 314159265359 + 314159265359).toString(36)}`;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => {})().constructor; // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

  if (!document.documentElement) {
    await Promise.resolve(0);
    while (!document.documentElement) {
      await new Promise(resolve => nextBrowserTick(resolve)).then().catch(console.warn);
    }
  }
  const sourceURL = 'debug://tabview-youtube/tabview.execution.js';
  const textContent = `(${executionScript})("${communicationKey}");${'\n\n'}//# sourceURL=${sourceURL}${'\n'}`;

  // Inject script using a script element with the page's nonce (if available) to comply with CSP
  let script = document.createElement('script');

  // Try to get the nonce from an existing script on the page
  const existingScript = document.querySelector('script[nonce]');
  if (existingScript && existingScript.nonce) {
    script.nonce = existingScript.nonce;
  }

  // Use TrustedTypes if available
  if (typeof trustedTypes !== 'undefined' && trustedTypes.defaultPolicy) {
    script.textContent = trustedTypes.defaultPolicy.createScript(textContent);
  } else {
    script.textContent = textContent;
  }

  (document.head || document.documentElement).appendChild(script);
  script.remove();
  script = null;

  const style = document.createElement('style');
  const sourceURLMainCSS = 'debug://tabview-youtube/tabview.main.css';
  style.textContent = `${styles['main'].trim()}${'\n\n'}/*# sourceURL=${sourceURLMainCSS} */${'\n'}`;
  document.documentElement.appendChild(style);
})();
