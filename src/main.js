const executionScript = (
  /** @type {string} */ communicationKey,
  /** @type {{ enabled?: boolean }} */ opts = {}
) => {
  if (typeof window !== 'undefined' && window.__ytpMainExecDone__) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__ytpMainExecDone__ = true;
  }

  const createExecLogger = () => {
    const isDev =
      typeof window !== 'undefined' && Boolean(window.__ytpDebug__ || window.__ytpDevMode);
    return typeof window !== 'undefined' && window.YouTubePlusLogger?.createLogger
      ? window.YouTubePlusLogger.createLogger('Tabview')
      : {
          error: console.error,
          warn: console.warn,
          info: isDev ? console.log : () => {},
          debug: () => {},
          log: isDev ? console.log : () => {},
        };
  };
  const _ll = /** @type {ExecLogger} */ (createExecLogger());
  const _cm = typeof window !== 'undefined' ? window.YouTubePlusCleanupManager : null;
  /**
   * Safe observer registration helper that delegates to _cm if available,
   * or returns the raw observer instance if _cm is not present.
   * @template {IntersectionObserver | MutationObserver | ResizeObserver} T
   * @param {T} observer
   * @param {Element|null} [element]
   * @param {{ scope?: string } | null} [options]
   * @returns {T}
   */
  const _registerObserver = (observer, element = null, options = null) => {
    if (_cm && typeof _cm.registerObserver === 'function') {
      return /** @type {T} */ (_cm.registerObserver(observer, element, options || undefined));
    }
    return observer;
  };

  /**
   * Safe listener registration helper that delegates to _cm if available,
   * or falls back to target.addEventListener if _cm is not present.
   * @param {EventTarget|null|undefined} target
   * @param {string} type
   * @param {EventListenerOrEventListenerObject} listener
   * @param {boolean|AddEventListenerOptions} [options]
   * @param {boolean} [isSession]
   * @returns {symbol | null}
   */
  const _registerListener = (target, type, listener, options = undefined, isSession = false) => {
    if (!target) return null;
    if (_cm && typeof _cm.registerListener === 'function') {
      return _cm.registerListener(
        target,
        type,
        /** @type {EventListener} */ (listener),
        options,
        isSession
      );
    }
    if (typeof target.addEventListener === 'function') {
      target.addEventListener(type, listener, options); // lint:custom:ignore
    }
    return null;
  };
  /** @type {YouTubeSafeDOM | null} */ const _safeDOM =
    (typeof window !== 'undefined' && window.YouTubeSafeDOM) || null;
  /** @type {YouTubePlusMutationCoordinatorAPI | null} */ const _mc =
    (typeof window !== 'undefined' && window.YouTubePlusMutationCoordinator) || null;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'Main');

  /**
   * A YouTube Polymer element prototype. The core patches lifecycle, observer
   * and data members by runtime name (`attached498`, `_dataChanged496`, ...),
   * which cannot be listed, so this stays a runtime-name-addressable record.
   * @typedef {{ [key: string]: any; [key: symbol]: any }} YtProto
   */
  /**
   * Page-realm execution logger: the facade logger when available, otherwise a
   * console-like fallback. Tabview passes numeric codes and error objects, so
   * the methods accept any arguments.
   * @typedef {{ error: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void; debug: (...args: unknown[]) => void; log: (...args: unknown[]) => void }} ExecLogger
   */

  const FLAG = {
    THEATER: 1,
    TAB_SELECTED: 2,
    CHAT_COLLAPSED: 4,
    CHAT_EXPANDED: 8,
    TWO_COLUMNS: 16,
    ENGAGEMENT_PANEL: 32,
    FULLSCREEN: 64,
    PLAYLIST: 128,
    EXTERNAL_YTLSTM: 4096,
    ALL_STANDARD: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128,
    ALL: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 4096,
  };

  // the enablement flag is handed in from the userscript realm
  // (loadFeatureEnabled): the page realm has no SettingsStore, so its own
  // probing always returned true here.
  const tabviewEnabled = !(opts && opts.enabled === false);

  // This core runs in the PAGE realm, where the sandbox's YouTubeSafeDOM is
  // absent. YouTube enforces `require-trusted-types-for 'script'` (Chrome and
  // Firefox), so a raw string assigned to an HTML sink is blocked there. A
  // private page-realm policy, created once and never exposed, wraps only the
  // static tab markup built below (its i18n text is escaped).
  /** @type {{ createHTML: (value: string) => string } | null | undefined} undefined until the first use */
  let pageHtmlPolicy;
  /** @param {string} s */
  const createHTML = s => {
    if (_safeDOM && typeof _safeDOM.createTrustedHTML === 'function') {
      return _safeDOM.createTrustedHTML(s);
    }
    const tt =
      /** @type {{ trustedTypes?: { createPolicy?: (name: string, rules: { createHTML: (value: string) => string }) => { createHTML: (value: string) => string } } }} */ (
        window
      ).trustedTypes;
    if (tt && typeof tt.createPolicy === 'function') {
      if (pageHtmlPolicy === undefined) {
        try {
          pageHtmlPolicy = tt.createPolicy('ytplus-tabview', {
            createHTML: (/** @type {string} */ x) => x,
          });
        } catch (e) {
          logS(e);
          pageHtmlPolicy = null;
        }
      }
      if (pageHtmlPolicy) return pageHtmlPolicy.createHTML(s);
    }
    return s;
  };

  /** @returns {unknown} the thrown error, or null when the probe succeeded */
  const probeTrustedHTML = () => {
    try {
      const probe = document.createElement('div');
      if (_safeDOM && typeof _safeDOM.createFragment === 'function') {
        probe.appendChild(_safeDOM.createFragment(createHTML('1')));
      } else {
        probe.textContent = createHTML('1');
      }
      return null;
    } catch (e) {
      logS(e);
      return e;
    }
  };

  const trustHTMLErr = probeTrustedHTML();

  if (trustHTMLErr) {
    _ll.error('trustHTMLErr', trustHTMLErr);
    return;
  }

  try {
    if (typeof CustomElementRegistry === 'undefined') return;
    // Stop only when this page-context patch has already been installed.
    if (typeof CustomElementRegistry.prototype.define000 === 'function') return;
    if (typeof CustomElementRegistry.prototype.define !== 'function') return;

    /**
     * Install the 000/111 prototype helpers and return the two the core reuses.
     * @returns {{ HTMLElement_: typeof HTMLElement, qsOne: (elm: Element, selector: string) => Element|null }}
     */
    const installPrototypePatches = () => {
      /** @type {typeof HTMLElement} */
      // cross-realm: the page's HTMLElement prototype differs from the sandbox's
      const HTMLElement_ = /** @type {typeof HTMLElement} */ (
        /** @type {unknown} */ (HTMLElement.prototype.constructor)
      );

      /** @param {Element} elm @param {string} selector */
      const qsOne = (elm, selector) => {
        return HTMLElement_.prototype.querySelector.call(elm, selector);
      };

      /** @param {unknown} p @param {Record<string, PropertyDescriptor>} o */
      const defineProperties = (p, o) => {
        if (!p) {
          _ll.warn(`defineProperties ERROR: Prototype is undefined`);
          return;
        }
        for (const k of Object.keys(o)) {
          if (!o[k]) {
            _ll.warn(`defineProperties ERROR: Property ${k} is undefined`);
            delete o[k];
          }
        }
        return Object.defineProperties(p, o);
      };

      /** @this {Element} @param {...Node} new_children */
      const replaceChildrenPolyfill = function replaceChildren(...new_children) {
        let el = this.firstChild;
        while (el) {
          const next = el.nextSibling;
          el.remove();
          el = next;
        }
        this.append(...new_children);
      };

      const pdsBaseDF = Object.getOwnPropertyDescriptors(DocumentFragment.prototype);

      if (pdsBaseDF.replaceChildren) {
        defineProperties(DocumentFragment.prototype, {
          replaceChildren000: pdsBaseDF.replaceChildren,
        });
      } else {
        DocumentFragment.prototype.replaceChildren000 = replaceChildrenPolyfill;
      }

      const pdsBaseNode = Object.getOwnPropertyDescriptors(Node.prototype);

      if (!(pdsBaseNode.appendChild000 || pdsBaseNode.insertBefore000)) {
        defineProperties(Node.prototype, {
          appendChild000: pdsBaseNode.appendChild,
          insertBefore000: pdsBaseNode.insertBefore,
        });
      }

      const pdsBaseElement = Object.getOwnPropertyDescriptors(Element.prototype);

      if (!(pdsBaseElement.setAttribute000 || pdsBaseElement.querySelector000)) {
        /** @type {Record<string, PropertyDescriptor>} */
        const nPdsElement = {
          setAttribute000: pdsBaseElement.setAttribute,
          getAttribute000: pdsBaseElement.getAttribute,
          hasAttribute000: pdsBaseElement.hasAttribute,
          removeAttribute000: pdsBaseElement.removeAttribute,
          querySelector000: pdsBaseElement.querySelector,
        };

        if (pdsBaseElement.replaceChildren) {
          nPdsElement.replaceChildren000 = pdsBaseElement.replaceChildren;
        } else {
          Element.prototype.replaceChildren000 = replaceChildrenPolyfill;
        }

        defineProperties(Element.prototype, nPdsElement);
      }

      /** @this {Element} @param {string} p @param {string | number | boolean} v */
      Element.prototype.setAttribute111 = function (p, v) {
        v = `${v}`;
        if (this.getAttribute000(p) === v) return;
        this.setAttribute000(p, v);
      };

      /** @this {Element} @param {string} p */
      Element.prototype.incAttribute111 = function (p) {
        let v = Number(this.getAttribute000(p)) || 0;
        v = v > 1e9 ? 9 : v + 1;
        this.setAttribute000(p, `${v}`);
        return v;
      };

      return { HTMLElement_, qsOne };
    };
    const { HTMLElement_, qsOne } = installPrototypePatches();

    /**
     * @param {Event} evt
     * @returns {Element | null} the hovered watch-metadata element, or null
     */
    const getHoveredMetaData = evt => {
      const target = evt ? evt.target : null;
      if (!(target instanceof HTMLElement_)) return null;
      return target.closest('ytd-watch-metadata') || null;
    };

    /**
     * @param {ParentNode} host
     * @param {Node} excluded
     * @returns {Node[]} every child of `host` except `excluded`
     */
    const collectOtherChildren = (host, excluded) => {
      /** @type {Node[]} */
      const others = [];
      for (let child = host.firstChild; child instanceof Node; child = child.nextSibling) {
        if (child !== excluded) others.push(child);
      }
      return others;
    };

    /**
     * Move `node` between `previousSiblings` and `nextSiblings` in place, without
     * detaching the host's other children.
     * @param {Element} host
     * @param {Node} node
     * @param {Node[]|null} previousSiblings
     * @param {Node[]|null} nextSiblings
     * @param {Node[]} others
     */
    const moveBetweenSiblings = (host, node, previousSiblings, nextSiblings, others) => {
      const fragment = new DocumentFragment();
      if (others.length > 0) fragment.replaceChildren000(...others);
      if (previousSiblings && previousSiblings.length > 0) {
        fragment.replaceChildren000(...previousSiblings);
        host.insertBefore000(fragment, node);
      }
      if (nextSiblings && nextSiblings.length > 0) {
        fragment.replaceChildren000(...nextSiblings);
        host.appendChild000(fragment);
      }
      fragment.replaceChildren000();
    };

    /** @param {Node[]} others */
    const removeDisconnectedChildren = others => {
      for (const child of others) {
        if (child instanceof Element && child.isConnected === false) child.remove(); // remove triggering
      }
    };

    /**
     * @this {Element}
     * @param {Node[] | null} previousSiblings
     * @param {Node} node
     * @param {Node[] | null} nextSiblings
     */
    Element.prototype.assignChildren111 = function (previousSiblings, node, nextSiblings) {
      // assume all previousSiblings, node, and nextSiblings are on the page
      //  -> only remove triggering is needed
      const others = collectOtherChildren(this, node);
      inPageRearrange = true;
      if (node.parentNode === this) {
        moveBetweenSiblings(this, node, previousSiblings, nextSiblings, others);
      } else {
        this.replaceChildren000(...(previousSiblings || []), node, ...(nextSiblings || []));
      }
      inPageRearrange = false;
      removeDisconnectedChildren(others);
    };

    let secondaryInnerHold = 0;

    /** @param {() => unknown} cb */
    const secondaryInnerFn = cb => {
      if (secondaryInnerHold) {
        secondaryInnerHold++;
        try {
          return cb();
        } finally {
          secondaryInnerHold--;
        }
      }
      const ea = document.querySelector('#secondary-inner');
      const eb = document.querySelector('secondary-wrapper#secondary-inner-wrapper');
      if (ea && eb) {
        secondaryInnerHold++;
        ea.id = 'secondary-inner-';
        eb.id = 'secondary-inner';
        try {
          return cb();
        } finally {
          ea.id = 'secondary-inner';
          eb.id = 'secondary-inner-wrapper';
          secondaryInnerHold--;
        }
      }
      return cb();
    };

    const DISABLE_FLAGS_SHADYDOM_FREE = true;

    (() => {
      /** @type {Window & typeof globalThis} */
      const pageGlobal = /** @type {Window & typeof globalThis} */ (
        'undefined' !== typeof unsafeWindow ? unsafeWindow : globalThis
      );
      if (!pageGlobal._ytConfigHacks) {
        // yt.config_ subscribers; after a few applications it warns.
        let remainingApplications = 4;
        const _win = pageGlobal;
        class ConfigSubscribers extends Set {
          /** @param {unknown} callback @returns {this} */
          add(callback) {
            if (remainingApplications <= 0) {
              _ll.warn('yt.config_ is already applied on the page.');
              return this;
            }
            if ('function' === typeof callback) super.add(callback);
            return this;
          }
        }
        /** @type {any} */
        const PromiseCtor = (async () => {})().constructor;
        const subscribers = (pageGlobal._ytConfigHacks = new ConfigSubscribers());
        // Hand the page's own ytcsi back as soon as the config has been read.
        /** @type {(() => void) | null} */
        let restoreYtcsi = () => {
          const original = _win.ytcsi?.originalYtcsi;
          if (original) {
            _win.ytcsi = original;
            restoreYtcsi = null;
          }
        };
        /** @type {boolean | null} */
        let configApplied = null;
        // Proxy reads left before the page's own ytcsi is restored.
        let proxyReadsBeforeRestore = 1;
        const applyConfig = () => {
          if (remainingApplications >= 1) {
            /** @type {Record<string, unknown>} */
            const config = _win.yt?.config_ || _win.ytcfg?.data_ || {};
            if (
              'string' === typeof config.INNERTUBE_API_KEY &&
              'object' === typeof config.EXPERIMENT_FLAGS
            ) {
              if (--remainingApplications <= 0) restoreYtcsi?.();
              configApplied = true;
              for (const subscriber of subscribers) subscriber(config);
            }
          }
        };
        /**
         * Wrap the page's ytcsi so the first read applies the config.
         * @param {unknown} [target]
         * @returns {boolean}
         */
        const wrapYtcsi = (target = undefined) => {
          const ytcsi = /** @type {YtTimingFunction | undefined} */ (target) || _win.ytcsi;
          if (!ytcsi) return false;
          _win.ytcsi = /** @type {YtTimingFunction} */ (
            new Proxy(ytcsi, {
              get: (/** @type {YtProto} */ self, /** @type {string | symbol} */ property) =>
                'originalYtcsi' === property
                  ? self
                  : (applyConfig(),
                    configApplied && --proxyReadsBeforeRestore <= 0 && restoreYtcsi?.(),
                    self[property]),
            })
          );
          return true;
        };
        wrapYtcsi() ||
          Object.defineProperty(_win, 'ytcsi', {
            get() {},
            set: /** @param {unknown} value */ value => (
              value && (delete _win.ytcsi, wrapYtcsi(value)), true
            ),
            enumerable: false,
            configurable: true,
          });
        const {
          addEventListener: docAddEventListener,
          removeEventListener: docRemoveEventListener,
        } = Document.prototype;
        /** @param {unknown} _event */
        /** @param {unknown} [_event] */
        function onConfigReady(_event = undefined) {
          applyConfig();
          if (_event) pageGlobal.removeEventListener('DOMContentLoaded', onConfigReady, false);
        }
        new PromiseCtor((/** @type {() => void} */ resolve) => {
          if ('undefined' !== typeof AbortSignal) {
            docAddEventListener.call(document, 'yt-page-data-fetched', resolve, { once: true });
            docAddEventListener.call(document, 'yt-navigate-finish', resolve, { once: true });
            docAddEventListener.call(document, 'spfdone', resolve, { once: true });
          } else {
            const handler = () => {
              resolve();
              docRemoveEventListener.call(document, 'yt-page-data-fetched', handler, false);
              docRemoveEventListener.call(document, 'yt-navigate-finish', handler, false);
              docRemoveEventListener.call(document, 'spfdone', handler, false);
            };
            docAddEventListener.call(document, 'yt-page-data-fetched', handler, false);
            docAddEventListener.call(document, 'yt-navigate-finish', handler, false);
            docAddEventListener.call(document, 'spfdone', handler, false);
          }
        }).then(applyConfig);
        new PromiseCtor((/** @type {() => void} */ resolve) => {
          if ('undefined' !== typeof AbortSignal) {
            docAddEventListener.call(document, 'yt-action', resolve, { once: true, capture: true });
          } else {
            const handler = () => {
              resolve();
              docRemoveEventListener.call(document, 'yt-action', handler, true);
            };
            docAddEventListener.call(document, 'yt-action', handler, true);
          }
        }).then(applyConfig);
        PromiseCtor.resolve().then(() => {
          if ('loading' !== document.readyState) onConfigReady();
          else _registerListener(pageGlobal, 'DOMContentLoaded', onConfigReady, false, false);
        });
      }
    })();

    let configOnce = false;
    window._ytConfigHacks?.add(config_ => {
      if (configOnce) return;
      configOnce = true;

      /** @type {Record<string, unknown>} */
      const EXPERIMENT_FLAGS = /** @type {Record<string, unknown>} */ (
        config_.EXPERIMENT_FLAGS || 0
      );
      /** @type {Record<string, unknown>} */
      const EXPERIMENTS_FORCED_FLAGS = /** @type {Record<string, unknown>} */ (
        config_.EXPERIMENTS_FORCED_FLAGS || 0
      );
      for (const flags of [EXPERIMENT_FLAGS, EXPERIMENTS_FORCED_FLAGS]) {
        if (flags) {
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

    /* globals WeakRef:false */

    /** @type {(o: any) => WeakRef<any> | null} */
    const mWeakRef =
      typeof WeakRef === 'function' ? o => (o ? new WeakRef(o) : null) : o => o || null;

    /** @type {(wr: any) => any} */
    const kRef = wr => (wr?.deref ? wr.deref() : wr);

    /** @type {any} */
    const Promise = (async () => {})().constructor; // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

    const setTimeout_ = setTimeout;

    /** @param {number} delay */
    const delayPn = (/** @type {number} */ delay) =>
      new Promise((/** @type {() => void} */ fn) => setTimeout_(fn, delay));

    /** @param {any} o */
    const insp = o => (o ? o.polymerController || o.inst || o || 0 : o || 0);

    /** @param {HTMLMediaElement} media */
    const isVideoPlaying = media => {
      return media.paused === false && media.readyState > 2 && !media.ended;
    };

    /**
     * @this {Element}
     * @param {string} selector
     */
    const closestFromAnchor = function (selector) {
      let el = /** @type {Element|null} */ (this);
      while (el) {
        if (el.matches(selector)) return el;
        el =
          el.parentElement ||
          (el.getRootNode() instanceof ShadowRoot
            ? /** @type {ShadowRoot} */ (el.getRootNode()).host
            : null);
      }
      return null;
    };

    /**
     * @this {Element|DocumentFragment}
     * @param {string} selector
     */
    const _querySelector = function (selector) {
      const found = this.querySelector(selector);
      if (found) return found;
      const shadows = this.querySelectorAll('*');
      for (const el of shadows) {
        const root = el.shadowRoot;
        if (root) {
          const r = root.querySelector(selector);
          if (r) return r;
        }
      }
      return null;
    };

    /**
     * A comments contents-renderer location: its parent element and child index.
     * @typedef {object} ContentsRendererRef
     * @property {HTMLElement} parent
     * @property {number} index
     */
    /** @param {Element} element @returns {ContentsRendererRef | null} */
    const findContentsRenderer = element => {
      let el = element;
      while (el) {
        const parent = el.parentElement;
        if (!parent) break;
        if (parent.nodeName === 'YTD-COMMENTS' || parent.nodeName === 'YTD-ITEM-SECTION-RENDERER') {
          const children = Array.from(parent.children);
          const idx = children.indexOf(el);
          if (idx >= 0) return { parent, index: idx };
        }
        el = parent;
      }
      return null;
    };

    const PromiseExternal = ((
      /** @type {(value?: unknown) => void} */ resolve_ = () => {},
      /** @type {(reason?: unknown) => void} */ reject_ = () => {}
    ) => {
      const h = (
        /** @type {(value?: unknown) => void} */ resolve,
        /** @type {(reason?: unknown) => void} */ reject
      ) => {
        resolve_ = resolve;
        reject_ = reject;
      };
      return class PromiseExternal extends Promise {
        constructor(cb = h) {
          super(cb);
          if (cb === h) {
            /** @type {(value?: unknown) => void} */
            this.resolve = resolve_;
            /** @type {(reason?: unknown) => void} */
            this.reject = reject_;
          }
        }
      };
    })();

    /**
     * Run callbacks at the start of the next task, after the current one and
     * its microtasks finish (a MessageChannel message, not a throttled timer).
     * Callbacks queued in the same task run together in one message.
     * @returns {(callback: () => void) => void}
     */
    const createNextBrowserTick = () => {
      /** @type {Array<() => void>} */
      let queue = [];
      /** @type {MessageChannel | null} */
      let channel = null;
      const flush = () => {
        const callbacks = queue;
        queue = [];
        for (const callback of callbacks) callback();
      };
      return (/** @type {() => void} */ callback) => {
        queue.push(callback);
        if (queue.length > 1) return;
        if (!channel) {
          channel = new MessageChannel();
          channel.port1.onmessage = flush;
        }
        channel.port2.postMessage(null);
      };
    };
    const nextBrowserTick = createNextBrowserTick();

    const isPassiveArgSupport = typeof IntersectionObserver === 'function';
    const capturePassive = isPassiveArgSupport ? { capture: true, passive: true } : true;

    class Attributer {
      /**
       * @param {string} list
       */
      constructor(list) {
        this.list = list;
        this.flag = 0;
      }
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

    const mLoaded = new Attributer('icp');

    const wrSelfMap = new WeakMap();

    /** @type {Record<string, any>} */
    const elements = new Proxy(
      {
        related: null,
        comments: null,
        infoExpander: null,
      },
      {
        get(target, prop) {
          return kRef(/** @type {YtProto} */ (target)[prop]);
        },
        set(target, prop, value) {
          if (value) {
            let wr = wrSelfMap.get(value);
            if (!wr) {
              wr = mWeakRef(value);
              wrSelfMap.set(value, wr);
            }
            /** @type {YtProto} */ (target)[prop] = wr;
          } else {
            /** @type {YtProto} */ (target)[prop] = null;
          }
          return true;
        },
      }
    );
    const getMainInfo = () => {
      const infoExpander = elements.infoExpander;
      if (!infoExpander) return null;
      const mainInfo = infoExpander.matches('[tyt-main-info]')
        ? infoExpander
        : infoExpander.querySelector000('[tyt-main-info]');
      return mainInfo || null;
    };
    /** @type {string | null} */ let pageType = null;

    const i18nT = window.YouTubePlusI18n?.t || (k => k);
    /**
     * @param {string} str
     */
    const escapeHTML = str => {
      if (_safeDOM?.escapeHTML) return _safeDOM.escapeHTML(str);
      return window.YouTubeUtils?.escapeHTML?.(str) ?? '';
    };

    const svgComments = `<path d="M80 27H12A12 12 90 0 0 0 39v42a12 12 90 0 0 12 12h12v20a2 2 90 0 0 3.4 2L47 93h33a12 12 90 0 0 12-12V39a12 12 90 0 0-12-12zM20 47h26a2 2 90 1 1 0 4H20a2 2 90 1 1 0-4zm52 28H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm0-12H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm36-58H40a12 12 90 0 0-12 12v6h52c9 0 16 7 16 16v42h0v4l7 7a2 2 90 0 0 3-1V71h2a12 12 90 0 0 12-12V17a12 12 90 0 0-12-12z"/>`;
    const svgVideos = `<path d="M89 10c0-4-3-7-7-7H7c-4 0-7 3-7 7v70c0 4 3 7 7 7h75c4 0 7-3 7-7V10zm-62 2h13v10H27V12zm-9 66H9V68h9v10zm0-56H9V12h9v10zm22 56H27V68h13v10zm-3-25V36c0-2 2-3 4-2l12 8c2 1 2 4 0 5l-12 8c-2 1-4 0-4-2zm25 25H49V68h13v10zm0-56H49V12h13v10zm18 56h-9V68h9v10zm0-56h-9V12h9v10z"/>`;
    const svgInfo = `<path d="M30 0C13.3 0 0 13.3 0 30s13.3 30 30 30 30-13.3 30-30S46.7 0 30 0zm6.2 46.6c-1.5.5-2.6 1-3.6 1.3a10.9 10.9 0 0 1-3.3.5c-1.7 0-3.3-.5-4.3-1.4a4.68 4.68 0 0 1-1.6-3.6c0-.4.2-1 .2-1.5a20.9 20.9 90 0 1 .3-2l2-6.8c.1-.7.3-1.3.4-1.9a8.2 8.2 90 0 0 .3-1.6c0-.8-.3-1.4-.7-1.8s-1-.5-2-.5a4.53 4.53 0 0 0-1.6.3c-.5.2-1 .2-1.3.4l.6-2.1c1.2-.5 2.4-1 3.5-1.3s2.3-.6 3.3-.6c1.9 0 3.3.6 4.3 1.3s1.5 2.1 1.5 3.5c0 .3 0 .9-.1 1.6a10.4 10.4 90 0 1-.4 2.2l-1.9 6.7c-.2.5-.2 1.1-.4 1.8s-.2 1.3-.2 1.6c0 .9.2 1.6.6 1.9s1.1.5 2.1.5a6.1 6.1 90 0 0 1.5-.3 9 9 90 0 0 1.4-.4l-.6 2.2zm-3.8-35.2a1 1 0 010 8.6 1 1 0 010-8.6z"/>`;
    const svgPlayList = `<path d="M0 3h12v2H0zm0 4h12v2H0zm0 4h8v2H0zm16 0V7h-2v4h-4v2h4v4h2v-4h4v-2z"/>`;

    /**
     * @param {number} w
     * @param {number} h
     * @param {number} vw
     * @param {number} vh
     * @param {string} p
     * @param {string} [m]
     */
    const svgElm = (w, h, vw, vh, p, m = undefined) =>
      `<svg${m ? ` class=${m}` : ''} width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;

    const hiddenTabsByUserCSS = 0;

    function getTabsHTML() {
      const sTabBtnVideos = `${svgElm(16, 16, 90, 90, svgVideos)}<span>${escapeHTML(i18nT('videos'))}</span>`;
      const sTabBtnInfo = `${svgElm(16, 16, 60, 60, svgInfo)}<span>${escapeHTML(i18nT('info'))}</span>`;
      const sTabBtnPlayList = `${svgElm(16, 16, 20, 20, svgPlayList)}<span>${escapeHTML(i18nT('playlist'))}</span>`;

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

    const setLangForPage = () => {
      const lang =
        window.YouTubePlusI18n?.getLanguage?.() || document.documentElement?.lang || 'en';
      document.documentElement?.setAttribute('data-yp-lang', lang);
    };

    /** @type {Record<string, number>} */
    const _locks = {};

    const lockGet = new Proxy(_locks, {
      get(/** @type {YtProto} */ target, prop) {
        return target[prop] || 0;
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    const lockSet = new Proxy(_locks, {
      get(/** @type {YtProto} */ target, prop) {
        if (target[prop] > 1e9) target[prop] = 9;
        return (target[prop] = (target[prop] || 0) + 1);
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    /**
     * Set by the tabview command bridge near the end of this script.
     * Declared here so switchToTab() can notify the sandbox without
     * knowing anything about the bridge itself.
     * @type {((evt: string, detail?: unknown) => void) | null}
     */
    let tabviewEmit = null;

    let videosElementProvidedPromise = new PromiseExternal();
    let navigateFinishedPromise = new PromiseExternal();

    let isRightTabsInserted = false;
    /** Listener key for the rail's tab-button click handler; released with the rail. @type {symbol | null} */
    let tabsBtnClickKey = null;
    let rightTabsProvidedPromise = new PromiseExternal();

    let infoExpanderElementProvidedPromise = new PromiseExternal();

    /** Kick off the deferred tabview insert chains. */
    const scheduleInsertChains = () => {
      Promise.all([videosElementProvidedPromise, navigateFinishedPromise])
        .then(eventMap.onceInsertRightTabs)
        .catch(_ll.warn);
      Promise.all([navigateFinishedPromise, infoExpanderElementProvidedPromise])
        .then(eventMap.onceInfoExpanderElementProvidedPromised)
        .catch(_ll.warn);
    };

    const resetTabviewInsertPromises = () => {
      isRightTabsInserted = false;
      videosElementProvidedPromise = new PromiseExternal();
      navigateFinishedPromise = new PromiseExternal();
      rightTabsProvidedPromise = new PromiseExternal();
      infoExpanderElementProvidedPromise = new PromiseExternal();

      elements.related = null;
      elements.comments = null;
      elements.infoExpander = null;
      elements.flexy = null;
      elements.chat = null;
      elements.playlist = null;

      scheduleInsertChains();
    };

    /** @type {Record<string, boolean>} */
    const pluginsDetected = {};

    let _observeTargetCounter = 0;

    /**
     * @param {(mutations: MutationRecord[]) => void} callback
     * @param {SubscriptionOptions} options
     * @param {string | { id: string | null } | null} subIdRef
     * @param {Element} element
     */
    const observeTarget = (subIdRef, element, callback, options) => {
      const id = typeof subIdRef === 'string' || !subIdRef ? null : subIdRef.id;
      if (id && _mc?.unwatch) _mc.unwatch(id);
      const subId =
        typeof subIdRef === 'string' ? subIdRef : `main::observeTarget:${++_observeTargetCounter}`;
      if (typeof subIdRef === 'object' && subIdRef) subIdRef.id = subId;
      if (_mc?.watchTarget) {
        _mc.watchTarget(subId, element, callback, options);
      } else {
        const mo = _registerObserver(new MutationObserver(callback), null, {
          scope: 'session',
        });
        const observeOptions = { ...options };
        delete observeOptions.selector;
        mo.observe(element, /** @type {MutationObserverInit} */ (observeOptions));
      }
      return subId;
    };

    const SECONDARY_INNER_METHODS = [
      ['isTwoColumnsChanged_', 2],
      ['defaultTwoColumnLayoutChanged'],
      ['updatePlayerLocation'],
      ['updateCinematicsLocation'],
      ['updatePanelsLocation'],
      ['swatcherooUpdatePanelsLocation', 6],
      ['updateErrorScreenLocation'],
      ['updateFullBleedElementLocations'],
    ];

    /**
     * @param {string} method
     * @param {string} tag
     * @param {YtProto} cProto
     */
    const patchLifecycle = (cProto, tag, method) => {
      const key = `${method}498`;
      if (!cProto[key] && typeof cProto[method] === 'function') {
        cProto[key] = cProto[method];
        cProto[method] = /** @param {...unknown} args */ function (...args) {
          if (!inPageRearrange)
            Promise.resolve(this.hostElement).then(eventMap[`${tag}::${method}`]).catch(_ll.warn);
          return this[key](...args);
        };
      }
    };

    /**
     * @param {MutationRecord[]} mutations
     */
    const onPluginMutation = mutations => {
      const newPlugins = [];
      const attributeChangedSet = new Set();
      for (const mutation of mutations) {
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
      for (const detected of newPlugins) {
        const pluginItem = plugin[`${detected}`];
        if (pluginItem) {
          pluginItem.activate();
        } else {
          _ll.warn(`No Plugin Activator for ${detected}`);
        }
      }
    };

    const setupPluginDetectObserver = () => {
      if (_mc?.subscribeRoot) {
        _mc.subscribeRoot('main::pluginDetect', onPluginMutation, {
          selector: 'html, body',
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: [
            'data-ytlstm-new-layout',
            'data-ytlstm-overlay-text-shadow',
            'data-ytlstm-theater-mode',
          ],
        });
        return;
      }
      const pluginDetectObserver = _registerObserver(new MutationObserver(onPluginMutation), null, {
        scope: 'session',
      });
      if (document.documentElement) {
        pluginDetectObserver.observe(document.documentElement, {
          attributes: true,
        });
      }
      if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
      navigateFinishedPromise.then(() => {
        if (document.documentElement) {
          pluginDetectObserver.observe(document.documentElement, {
            attributes: true,
          });
        }
        if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
      });
    };
    setupPluginDetectObserver();

    /**
     * @this {YtProto}
     * @param {unknown} _s
     */
    const funcCanCollapse = function (_s) {
      const content = this.content || this.$.content;
      this.canToggle =
        this.shouldUseNumberOfLines &&
        (this.alwaysCollapsed || this.collapsed || this.isToggled === false)
          ? this.alwaysToggleable ||
            this.isToggled ||
            (content && content.offsetHeight < content.scrollHeight)
          : this.alwaysToggleable ||
            this.isToggled ||
            (content && content.scrollHeight > this.collapsedHeight);
    };

    /**
     * @param {number} lockId
     */
    const aoChatAttrChangeFn = async lockId => {
      if (lockGet.aoChatAttrAsyncLock !== lockId) return;

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

    /**
     * @param {number} lockId
     */
    const aoPlayListAttrChangeFn = async lockId => {
      if (lockGet.aoPlayListAttrAsyncLock !== lockId) return;

      const playlistElm = elements.playlist;
      const ytdFlexyElm = elements.flexy;

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

    const onAoChatMutation = () => {
      Promise.resolve(lockSet.aoChatAttrAsyncLock).then(aoChatAttrChangeFn).catch(_ll.warn);
    };
    /** @type {string | null} */ let aoChatSubId = null;
    const onAoPlayListMutation = () => {
      Promise.resolve(lockSet.aoPlayListAttrAsyncLock).then(aoPlayListAttrChangeFn).catch(_ll.warn);
    };
    /** @type {string | null} */ let aoPlayListSubId = null;

    /**
     * @param {MutationRecord[]} mutations
     * @param {Element} area
     * @returns {{ hidden: boolean, videoId: boolean, disabled: boolean }}
     */
    const classifyCommentMutations = (mutations, area) => {
      const changed = { hidden: false, videoId: false, disabled: false };
      for (const mutation of mutations) {
        if (mutation.target !== area) continue;
        if (mutation.attributeName === 'hidden') changed.hidden = true;
        else if (mutation.attributeName === 'tyt-comments-video-id') changed.videoId = true;
        else if (mutation.attributeName === 'tyt-comments-data-status') changed.disabled = true;
      }
      return changed;
    };

    /**
     * Mirror the comments data status onto the flexy element.
     * @param {Element} flexy
     * @param {Element} area
     */
    const syncCommentDisabledAttribute = (flexy, area) => {
      const status = Number(area.getAttribute000('tyt-comments-data-status'));
      if (status === 2) flexy.setAttribute111('tyt-comment-disabled', '');
      else if (status === 1) flexy.removeAttribute000('tyt-comment-disabled');
    };

    /**
     * Show or hide the comments tab button to match the tab's own visibility.
     * @param {Element} area
     */
    const syncCommentsTabVisibility = area => {
      if (!area.closest('#tab-comments')) return;
      const shouldTabVisible = !area.closest('[hidden]');
      const commentsTabBtn = document.querySelector('[tyt-tab-content="#tab-comments"]');
      if (commentsTabBtn) commentsTabBtn.classList.toggle('tab-btn-hidden', !shouldTabVisible);
    };

    /**
     * @param {MutationRecord[]} mutations
     */
    const onAoCommentMutation = async mutations => {
      const commentsArea = elements.comments;
      const ytdFlexyElm = elements.flexy;

      // tyt-comments-video-id //tyt-comments-data-status // hidden
      if (!commentsArea) return;
      const changed = classifyCommentMutations(mutations, commentsArea);

      if (changed.hidden) {
        if (!commentsArea.hasAttribute000('hidden')) {
          Promise.resolve(commentsArea).then(eventMap.settingCommentsVideoId).catch(_ll.warn);
        }

        Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
          .then(removeKeepCommentsScroller)
          .catch(_ll.warn);
      }

      if (!((changed.hidden || changed.videoId || changed.disabled) && ytdFlexyElm)) return;
      syncCommentDisabledAttribute(ytdFlexyElm, commentsArea);

      Promise.resolve(lockSet.checkCommentsShouldBeHiddenLock)
        .then(eventMap.checkCommentsShouldBeHidden)
        .catch(_ll.warn);

      const lockId = lockSet.rightTabReadyLock01;
      await rightTabsProvidedPromise.then();
      if (lockGet.rightTabReadyLock01 !== lockId) return;

      if (elements.comments !== commentsArea) return;
      if (commentsArea.isConnected === false) return;

      syncCommentsTabVisibility(commentsArea);
    };
    /** @type {string | null} */ let aoCommentSubId = null;

    const ioComment = _registerObserver(
      new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const target = entry.target;
            const cnt = insp(target);
            if (
              entry.isIntersecting &&
              target instanceof HTMLElement_ &&
              typeof cnt.calculateCanCollapse === 'function'
            ) {
              lockSet.removeKeepCommentsScrollerLock;
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
      ),
      null,
      { scope: 'session' }
    );

    let bFixForResizedTabLater = false;
    let lastRoRightTabsWidth = 0;
    const roRightTabs = _registerObserver(
      new ResizeObserver(entries => {
        const entry = entries[entries.length - 1];
        const width = Math.round(entry.borderBoxSize[0].inlineSize);
        if (lastRoRightTabsWidth !== width) {
          lastRoRightTabsWidth = width;
          if ((tabAStatus & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) {
            bFixForResizedTabLater = false;
            Promise.resolve(1).then(eventMap.fixForTabDisplay);
          } else {
            bFixForResizedTabLater = true;
          }
        }
      }),
      null,
      { scope: 'session' }
    );

    /**
     * Apply the active/inactive class and hidden attribute for one tab link.
     * @param {Element} link
     * @param {Element} content
     * @param {boolean} isActive
     */
    const setTabLinkState = (link, content, isActive) => {
      if (isActive) {
        link.classList.add('active');
        if (content.hasAttribute000('tyt-hidden')) {
          content.removeAttribute000('tyt-hidden'); // for https://greasyfork.org/en/scripts/456108
        }
        content.classList.remove('tab-content-hidden');
        return;
      }
      link.classList.remove('active');
      content.classList.add('tab-content-hidden');
      if (!content.hasAttribute000('tyt-hidden')) {
        content.setAttribute111('tyt-hidden', ''); // for https://greasyfork.org/en/scripts/456108
      }
    };

    /**
     * @param {string | Element | null} activeLink
     */
    const switchToTab = activeLink => {
      if (typeof activeLink === 'string') {
        activeLink = document.querySelector(`a[tyt-tab-content="${activeLink}"]`) || null;
      }

      const ytdFlexyElm = elements.flexy;

      const links = document.querySelectorAll('#material-tabs a[tyt-tab-content]');

      for (const link of links) {
        const content = document.querySelector(
          /** @type {string} */ (link.getAttribute000('tyt-tab-content')) || ''
        );
        if (link && content) setTabLinkState(link, content, link === activeLink);
      }

      const switchingTo = activeLink ? activeLink.getAttribute000('tyt-tab-content') : '';
      if (switchingTo) {
        lastTab = lastPanel = switchingTo;
      }

      if (ytdFlexyElm.getAttribute000('tyt-chat') === '')
        ytdFlexyElm.removeAttribute000('tyt-chat');
      ytdFlexyElm.setAttribute111('tyt-tab', switchingTo);

      // Notify sandbox listeners. Before this existed, feature modules had to
      // detect tab switches by observing class mutations on .tab-content-cld
      // and by intercepting clicks on .tab-btn in the capture phase.
      if (tabviewEmit) tabviewEmit('tabchange', { tab: switchingTo || null });

      if (switchingTo) {
        bFixForResizedTabLater = false;
        Promise.resolve(0).then(eventMap.fixForTabDisplay);
      }
    };

    // One rule per tabview status bit: it is set when the flag is present, then
    // cleared again unless the matching document attribute/element says so.
    /** @type {Array<{ bit: number, present: (el: Element) => boolean }>} */
    const FLAG_RULES = [
      { bit: FLAG.THEATER, present: el => el.hasAttribute000('theater') },
      { bit: FLAG.TAB_SELECTED, present: el => !!el.getAttribute000('tyt-tab') },
      { bit: FLAG.CHAT_COLLAPSED, present: el => el.getAttribute000('tyt-chat') === '-' },
      { bit: FLAG.CHAT_EXPANDED, present: el => el.getAttribute000('tyt-chat') === '+' },
      { bit: FLAG.TWO_COLUMNS, present: el => el.hasAttribute000('is-two-columns_') },
      { bit: FLAG.ENGAGEMENT_PANEL, present: el => el.hasAttribute000('tyt-egm-panel_') },
      { bit: FLAG.FULLSCREEN, present: () => !!document.fullscreenElement },
      { bit: FLAG.PLAYLIST, present: el => el.hasAttribute000('tyt-playlist-expanded') },
      { bit: FLAG.EXTERNAL_YTLSTM, present: el => el.getAttribute('tyt-external-ytlstm') === '1' },
    ];

    let tabAStatus = 0;
    /**
     * @param {number} flag
     * @param {number} r
     */
    const calculationFn = (r, flag) => {
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return r;
      for (const { bit, present } of FLAG_RULES) {
        if (!(flag & bit)) continue;
        r |= bit;
        if (!present(ytdFlexyElm)) r -= bit;
      }
      return r;
    };

    function isTheater() {
      const ytdFlexyElm = elements.flexy;
      return ytdFlexyElm?.hasAttribute000('theater');
    }

    function ytBtnCancelTheater() {
      if (isTheater()) {
        const sizeBtn = document.querySelector(
          'ytd-watch-flexy #ytd-player button.ytp-size-button'
        );
        if (sizeBtn) /** @type {HTMLElement} */ (sizeBtn).click();
      }
    }

    /**
     * @param {string} selector
     */
    function getSuitableElement(selector) {
      const elements = document.querySelectorAll(selector);
      let j = -1,
        h = -1;
      for (let i = 0, l = elements.length; i < l; i++) {
        const d = elements[i].getElementsByTagName('*').length;
        if (d > h) {
          h = d;
          j = i;
        }
      }
      return j >= 0 ? elements[j] : null;
    }

    /**
     * @param {boolean} collapsed
     */
    function ytBtnToggleChat(collapsed) {
      const dom = getSuitableElement('ytd-live-chat-frame#chat');
      const cnt = insp(dom);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        if (typeof cnt.setCollapsedState === 'function') {
          cnt.setCollapsedState({
            setLiveChatCollapsedStateAction: { collapsed },
          });
          if (cnt.collapsed === collapsed) return;
        }
        cnt.collapsed = collapsed;
        if (cnt.collapsed === collapsed) return;
        if (cnt.isHiddenByUser === !collapsed && cnt.collapsed === !collapsed) {
          cnt.isHiddenByUser = collapsed;
          cnt.collapsed = collapsed;
        }
      }
      const sel = collapsed
        ? 'ytd-live-chat-frame#chat:not([collapsed]) > .ytd-live-chat-frame#show-hide-button'
        : 'ytd-live-chat-frame#chat[collapsed] > .ytd-live-chat-frame#show-hide-button';
      let button = document.querySelector(sel);
      if (button) {
        button =
          button.querySelector000('div.yt-spec-touch-feedback-shape') ||
          button.querySelector000('ytd-toggle-button-renderer');
        if (button) /** @type {HTMLElement} */ (button).click();
      }
    }

    const ytBtnExpandChat = () => ytBtnToggleChat(false);
    const ytBtnCollapseChat = () => ytBtnToggleChat(true);

    /** @typedef {{ panelId?: string, toHide?: boolean, toShow?: boolean }} EgmPanelAction */

    /**
     * @param {EgmPanelAction | EgmPanelAction[] | null} arr
     */
    function ytBtnEgmPanelCore(arr) {
      if (!arr) return;
      if (!('length' in arr)) arr = [arr];

      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;

      /** @type {unknown[]} */
      let actions = [];

      for (const entry of arr) {
        if (!entry) continue;

        const panelId = entry.panelId;

        const toHide = entry.toHide;
        const toShow = entry.toShow;

        if (toHide === true && !toShow) {
          actions.push({
            hideEngagementPanelEndpoint: {
              panelIdentifier: panelId,
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
      actions = [];
    }

    /**
     * @param {Element} panelElm
     */
    function getPanelIdentifier(panelElm) {
      const cnt = insp(panelElm);
      const panelIdentifier = (cnt.data || 0).panelIdentifier;
      if (panelIdentifier && typeof panelIdentifier === 'string') {
        return panelIdentifier;
      }
      const tag = ((cnt.data || 0).identifier || 0).tag;
      if (tag && typeof tag === 'string') {
        return tag;
      }
      const targetId = (cnt.data || 0).targetId;
      if (targetId && typeof targetId === 'string') {
        return targetId;
      }
      const id = panelElm.getAttribute000('target-id') || '';
      return id;
    }

    function ytBtnCloseEngagementPanels() {
      const actions = [];
      for (const panelElm of document.querySelectorAll(
        `ytd-watch-flexy[tyt-tab] #panels.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility]:not([hidden])`
      )) {
        if (
          panelElm.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          const pid = getPanelIdentifier(panelElm);
          actions.push({
            panelId: pid,
            toHide: true,
          });
        }
      }
      ytBtnEgmPanelCore(actions);
    }

    function ytBtnOpenPlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = false;
      }
    }
    function ytBtnClosePlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = true;
      }
    }

    /** @this {YtProto} */ const updateChatLocation498 = function () {
      if (this.is !== 'ytd-watch-grid') {
        secondaryInnerFn(() => {
          this.updatePageMediaQueries();
          this.schedulePlayerSizeUpdate_();
        });
      }
    };

    const mirrorNodeWS = new WeakMap();

    const dummyNode = document.createElement('noscript');

    const __j4836__ = Symbol();
    const __j5744__ = Symbol(); // original element
    const __j5733__ = Symbol(); // __lastChanged__

    /**
     * @this {YtProto}
     * @param {unknown} _mutations
     */
    const monitorDataChangedByDOMMutation = async function (_mutations) {
      const node = kRef(this);
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

    /**
     * @this {WeakRef<YtProto> | null}
     * @param {MutationRecord[]} mutations
     */
    const moChangeReflection = function (mutations) {
      const node = kRef(this);
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
     * @param {Element} elm
     * @param {string} prop
     */
    const attributeInc = (elm, prop) => {
      let v = (+(elm.getAttribute000(prop) || '0') || 0) + 1;
      if (v > 1e9) v = 9;
      elm.setAttribute000(prop, String(v));
      return v;
    };

    /**
     * @param {unknown} x
     */
    const isChannelId = x => {
      if (typeof x === 'string' && x.length === 24) {
        return /UC[-_a-zA-Z0-9+=.]{22}/.test(x);
      }
      return false;
    };

    /**
     * One element rendered in an extra-content slot, with the Polymer data and
     * tag name the mirror pass needs.
     * @typedef {{ data: unknown, tag: string, elm: Element, mirrored?: Element }} MirroredSourceElement
     */

    /**
     * @param {number} lockId
     */
    /**
     * Collect source elements rendered in the extra-content slots.
     * @returns {MirroredSourceElement[]}
     */
    const collectInfoExtraSourceElements = () => {
      const requireElements = [
        ...document.querySelectorAll(
          'ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"] > *, ytd-watch-metadata.ytd-watch-flexy #extra-content > *'
        ),
      ]
        .filter(elm => {
          return typeof (/** @type {YtPolymerElement} */ (elm).is) === 'string';
        })
        .map(elm => {
          const is = /** @type {YtPolymerElement} */ (elm).is;
          while (elm instanceof HTMLElement_) {
            const q = [...elm.querySelectorAll(/** @type {string} */ (is))].filter(
              e => insp(e).data
            );
            if (q.length >= 1) return q[0];
            elm = /** @type {Element} */ (elm.parentNode);
          }
          return undefined;
        })
        .filter(elm => !!elm && typeof (/** @type {YtPolymerElement} */ (elm).is) === 'string');

      return requireElements.map(entry => {
        const inst = insp(entry);
        return /** @type {MirroredSourceElement} */ ({
          data: inst.data,
          tag: inst.is,
          elm: entry,
        });
      });
    };

    /**
     * Ensure the hidden noscript holder for mirrored nodes exists.
     * @param {Element} ytdFlexyElm
     * @returns {Element}
     */
    const ensureInfoNoscript = ytdFlexyElm => {
      let noscript_ = document.querySelector('noscript#aythl');
      if (!noscript_) {
        noscript_ = document.createElement('noscript');
        noscript_.id = 'aythl';

        inPageRearrange = true;
        ytdFlexyElm.insertBefore000(noscript_, ytdFlexyElm.firstChild);
        inPageRearrange = false;
      }
      return noscript_;
    };

    /**
     * Patch the prototype so data changes bump the mirror refresh counter.
     * @param {Element & YtProto} s
     * @param {YtProto} cnt
     * @param {YtProto} cProto
     */
    const patchMirrorProtoDataObserver = (s, cnt, cProto) => {
      if (
        !(cProto instanceof Node || cProto._dataChanged496) &&
        typeof cProto._createPropertyObserver === 'function'
      ) {
        cProto._dataChanged496 = function () {
          const node = this.hostElement || this;
          if (node.jy8432) {
            attributeInc(node, 'tyt-data-change-counter');
          }
        };

        cProto._createPropertyObserver('data', '_dataChanged496', undefined);
      } else if (
        !(cProto instanceof Node || cProto._dataChanged496) &&
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
              Promise.resolve(cnt).then(cnt._dataChanged496k).catch(_ll.warn);
            return this.setWithPath573(...arguments);
          };
          cProto._dataChanged496 = function () {
            const node = this.hostElement || this;
            if (node.jy8432) {
              attributeInc(node, 'tyt-data-change-counter'); // next macro task
            }
          };
          /**
           * @param {YtProto} cnt
           */
          cProto._dataChanged496k = cnt => cnt._dataChanged496();
        }
      }

      if (!cProto._dataChanged496) {
        observeTarget(null, s, monitorDataChangedByDOMMutation.bind(s[__j5744__]), {
          attributes: true,
          childList: true,
          subtree: true,
        });
      }
    };

    /**
     * Check the DOM tree still mirrors the expected nodes in order.
     * @param {Element} targetParent
     * @param {Element} infoExpander
     * @param {Node[]} mirroElmArr
     * @returns {boolean} true when in sync
     */
    const isDomTreeInSync = (targetParent, infoExpander, mirroElmArr) => {
      let e = infoExpander ? -1 : 0;
      // DOM Tree Check
      for (let n = targetParent.firstChild; n instanceof Node; n = n.nextSibling) {
        const target = e < 0 ? infoExpander : mirroElmArr[e];
        e++;
        if (n !== target) {
          // target can be undefined if index overflow
          return false;
        }
      }
      return e === mirroElmArr.length + 1;
    };

    /**
     * Apply mirror nodes to the target parent and bump refresh counters.
     * @param {Element} targetParent
     * @param {Element} infoExpander
     * @param {Node[]} mirroElmArr
     */
    const applyMirrorNodes = (targetParent, infoExpander, mirroElmArr) => {
      if (infoExpander) {
        targetParent.assignChildren111(null, infoExpander, mirroElmArr);
      } else {
        targetParent.replaceChildren000(...mirroElmArr);
      }
      for (const mirrorElm of mirroElmArr) {
        // trigger data assignment and record refresh count by manual update
        const j = attributeInc(/** @type {Element} */ (mirrorElm), 'tyt-clone-refresh-count');
        const oriElm = kRef(/** @type {YtProto} */ (mirrorElm)[__j5744__] || null) || null;
        if (oriElm) {
          oriElm.setAttribute111('tyt-clone-refresh-count', j);
        }
      }
    };

    /**
     * Return the mirror node for one source element, creating it on first sight.
     * `alreadyChanged` skips the data comparison once an earlier element already
     * forced an update, matching the original short-circuit.
     * @param {unknown} data
     * @param {string} tag
     * @param {Element} sourceElm
     * @param {Element} noscript
     * @param {Element} targetParent
     * @param {boolean} alreadyChanged
     * @returns {{ mirrorNode: Element, changed: boolean }}
     */
    const ensureMirrorNode = (data, tag, sourceElm, noscript, targetParent, alreadyChanged) => {
      let mirrorNode = mirrorNodeWS.get(sourceElm);
      mirrorNode = mirrorNode ? kRef(mirrorNode) : mirrorNode;
      if (!mirrorNode) {
        const cnt = insp(sourceElm);
        const cProto = cnt.constructor.prototype;

        mirrorNode = document.createElement(tag);
        noscript.appendChild(mirrorNode); // appendChild to trigger .attached()
        /** @type {YtProto} */ (mirrorNode)[__j5744__] = mWeakRef(sourceElm);

        const nodeWR = mWeakRef(mirrorNode);
        mirrorNodeWS.set(sourceElm, nodeWR);
        mirrorNodeWS.set(mirrorNode, nodeWR);

        /** @type {YtProto} */ (sourceElm).jy8432 = 1;
        observeTarget(null, sourceElm, moChangeReflection.bind(nodeWR), {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['tyt-clone-refresh-count', 'tyt-data-change-counter'],
        });

        patchMirrorProtoDataObserver(sourceElm, cnt, cProto);
        return { mirrorNode, changed: true };
      }
      if (mirrorNode.parentNode !== targetParent) return { mirrorNode, changed: true };
      if (alreadyChanged) return { mirrorNode, changed: false };
      const cloneNodeCnt = insp(mirrorNode);
      return { mirrorNode, changed: cloneNodeCnt.data !== data };
    };

    /**
     * @param {number} lockId
     */
    const infoFix = lockId => {
      if (lockId !== null && lockGet.infoFixLock !== lockId) return;

      const infoExpander = elements.infoExpander;
      const infoContainer =
        (infoExpander ? infoExpander.parentNode : null) || document.querySelector('#tab-info');
      const ytdFlexyElm = elements.flexy;
      if (!(infoContainer && ytdFlexyElm)) return;

      if (infoExpander) {
        const match =
          infoExpander.matches('#tab-info > [class]') ||
          infoExpander.matches('#tab-info > [tyt-main-info]');
        if (!match) return;
      }

      const source = collectInfoExtraSourceElements();
      const noscript = ensureInfoNoscript(ytdFlexyElm);

      let requiredUpdate = false;
      const mirrorElmSet = new Set();
      const targetParent = infoContainer;
      for (const { data, tag, elm: s } of source) {
        const { mirrorNode, changed } = ensureMirrorNode(
          data,
          tag,
          s,
          noscript,
          targetParent,
          requiredUpdate
        );
        if (changed) requiredUpdate = true;
        mirrorElmSet.add(mirrorNode);
        /** @type {YtProto} */ (source).mirrored = mirrorNode;
      }

      const mirroElmArr = [...mirrorElmSet];
      mirrorElmSet.clear();

      if (!requiredUpdate) {
        requiredUpdate = !isDomTreeInSync(targetParent, infoExpander, mirroElmArr);
      }

      if (requiredUpdate) {
        applyMirrorNodes(targetParent, infoExpander, mirroElmArr);
      }

      mirroElmArr.length = 0;
      source.length = 0;
    };

    /**
     * @param {number} lockId
     */
    /**
     * @param {Element} secondaryWrapper
     * @param {Element | null} chatContainer
     * @param {Node[]} w2
     */
    const collectWrapperChildren = (secondaryWrapper, chatContainer, w2) => {
      for (
        let node2 = secondaryWrapper.firstChild;
        node2 instanceof Node;
        node2 = node2.nextSibling
      ) {
        if (node2 === chatContainer && chatContainer) {
          // already inside wrapper
        } else {
          if (chatContainer && /** @type {Element} */ (node2).id === 'right-tabs') {
            w2.push(chatContainer);
          }
          w2.push(node2);
        }
      }
    };

    /**
     * @param {Element} secondaryWrapper
     * @param {Element} secondaryInner
     * @param {Element | null} chatContainer
     */
    const collectSecondaryNodes = (secondaryWrapper, secondaryInner, chatContainer) => {
      /** @type {Node[]} */ const w = [];
      /** @type {Node[]} */ const w2 = [];
      for (let node = secondaryInner.firstChild; node instanceof Node; node = node.nextSibling) {
        if (node === chatContainer && chatContainer) {
          // will be appended to secondary-wrapper below
        } else if (node === secondaryWrapper) {
          collectWrapperChildren(secondaryWrapper, chatContainer, w2);
        } else {
          w.push(node);
        }
      }
      // Fallback: if chatContainer wasn’t found as a sibling, append it next to
      // right-tabs when it exists inside the wrapper.
      if (chatContainer && !w2.includes(chatContainer) && !w.includes(chatContainer)) {
        const rightTabsIndex = w2.findIndex(
          node => /** @type {Element} */ (node)?.id === 'right-tabs'
        );
        if (rightTabsIndex >= 0) {
          w2.splice(rightTabsIndex + 1, 0, chatContainer);
        } else {
          w2.push(chatContainer);
        }
      }
      return { w, w2 };
    };

    /**
     * @param {Element} secondaryWrapper
     */
    const refreshChatUrlHandlers = secondaryWrapper => {
      const chatElm = elements.chat;
      const chatCnt = insp(chatElm);
      if (
        chatCnt &&
        typeof chatCnt.urlChanged === 'function' &&
        secondaryWrapper.contains(chatElm)
      ) {
        if (typeof chatCnt.urlChangedAsync12 === 'function') {
          chatCnt.urlChanged();
        } else {
          setTimeout(() => chatCnt.urlChanged(), 136);
        }
      }
    };

    /**
     * @param {number} lockId
     */
    const layoutFix = lockId => {
      if (lockGet.layoutFixLock !== lockId) return;

      const secondaryWrapper = document.querySelector(
        '#secondary-inner.style-scope.ytd-watch-flexy > secondary-wrapper'
      );

      if (secondaryWrapper) {
        const secondaryInner = secondaryWrapper.parentNode;
        const chatContainer = document.querySelector(
          '#columns.style-scope.ytd-watch-flexy [tyt-chat-container]'
        );

        // Ensure the chat container (if any) is inside secondary-wrapper so the
        // right-rail layout owns it together with #right-tabs. Also normalize any
        // stray nodes that YouTube re-inserts outside secondary-wrapper.
        const needsFix =
          secondaryInner?.firstChild !== secondaryInner?.lastChild ||
          (chatContainer && chatContainer.closest('secondary-wrapper') === null);

        if (needsFix) {
          const { w, w2 } = collectSecondaryNodes(
            secondaryWrapper,
            /** @type {Element} */ (secondaryInner),
            chatContainer
          );
          inPageRearrange = true;
          secondaryWrapper.replaceChildren000(...w, ...w2);
          inPageRearrange = false;
          refreshChatUrlHandlers(secondaryWrapper);
        }
      }
    };
    let lastPanel = '';
    let lastTab = '';

    const onAoEgmPanelsMutation = () => {
      Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
    };
    /** @type {string | null} */ let aoEgmPanelsSubId = null;

    /**
     * @param {number} lockId
     */
    const removeKeepCommentsScroller = async lockId => {
      if (lockGet.removeKeepCommentsScrollerLock !== lockId) return;
      await Promise.resolve();
      if (lockGet.removeKeepCommentsScrollerLock !== lockId) return;
      const ytdFlexyElm = elements.flexy;
      if (ytdFlexyElm) {
        ytdFlexyElm.removeAttribute000('keep-comments-scroller');
      }
    };

    /**
     * Collect the engagement panels and mark newly expanded ones as visible.
     * @returns {{ newVisible: Element[], allVisible: Element[] }}
     */
    const classifyEgmPanels = () => {
      const newVisible = [];
      const allVisible = [];
      for (const panelElm of document.querySelectorAll('[tyt-egm-panel][target-id][visibility]')) {
        const visibility = panelElm.getAttribute000('visibility');
        if (visibility === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN' || panelElm.closest('[hidden]')) {
          if (panelElm.hasAttribute000('tyt-visible-at')) {
            panelElm.removeAttribute000('tyt-visible-at');
          }
        } else if (
          visibility === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' &&
          !panelElm.closest('[hidden]')
        ) {
          if (!panelElm.getAttribute000('tyt-visible-at')) {
            panelElm.setAttribute111('tyt-visible-at', Date.now());
            newVisible.push(panelElm);
          }
          allVisible.push(panelElm);
        }
      }
      return { newVisible, allVisible };
    };

    /**
     * Hide every other visible panel when a new one was just expanded.
     * @param {Element[]} newVisible
     * @param {Element[]} allVisible
     */
    const collapseOtherVisibleEgmPanels = (newVisible, allVisible) => {
      if (newVisible.length < 1 || allVisible.length < 2) return;
      const targetVisible = newVisible[newVisible.length - 1];

      const actions = [];
      for (const panelElm of allVisible) {
        if (panelElm === targetVisible) continue;
        actions.push({
          panelId: getPanelIdentifier(panelElm),
          toHide: true,
        });
      }

      if (actions.length >= 1) {
        ytBtnEgmPanelCore(actions);
      }
    };

    /**
     * @param {number} lockId
     */
    const updateEgmPanels = async lockId => {
      if (lockId !== lockGet.updateEgmPanelsLock) return;
      await navigateFinishedPromise.then().catch(_ll.warn);
      if (lockId !== lockGet.updateEgmPanelsLock) return;

      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;
      const { newVisible, allVisible } = classifyEgmPanels();
      collapseOtherVisibleEgmPanels(newVisible, allVisible);
      if (allVisible.length >= 1) {
        ytdFlexyElm.setAttribute111('tyt-egm-panel_', '');
      } else {
        ytdFlexyElm.removeAttribute000('tyt-egm-panel_');
      }
    };

    /**
     * @param {string} exclude
     * @param {string} css
     */
    const checkElementExist = (css, exclude) => {
      for (const p of document.querySelectorAll(css)) {
        if (!p.closest(exclude)) return p;
      }
      return null;
    };

    let fixInitialTabStateK = 0;

    const { handleNavigateFactory } = (() => {
      let isLoadStartListened = false;

      /**
       * @param {string} lc
       * @returns {{ lc: string, commentRendererElm: Element } | null}
       */
      function findLcCommentById(lc) {
        const element = document.querySelector(
          `#tab-comments ytd-comments ytd-comment-renderer #header-author a[href*="lc=${lc}"]`
        );
        if (!element) return null;
        const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
        if (!(commentRendererElm && lc)) return null;
        return { lc, commentRendererElm };
      }

      /**
       * @returns {{ lc: string, commentRendererElm: Element } | null}
       */
      function findLcCommentFromBadge() {
        const element = document.querySelector(
          `#tab-comments ytd-comments ytd-comment-renderer > #linked-comment-badge span:not(:empty)`
        );
        if (!element) return null;
        const commentRendererElm = closestFromAnchor.call(element, 'ytd-comment-renderer');
        if (!commentRendererElm) return null;

        let lc;
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
        if (!lc) return null;
        return { lc, commentRendererElm };
      }

      /**
       * @param {string} [lc]
       */
      function findLcComment(lc) {
        return arguments.length === 1
          ? findLcCommentById(/** @type {string} */ (lc))
          : findLcCommentFromBadge();
      }

      /** @param {Element} r1 */
      function cloneLinkedCommentBadge(r1) {
        const p = Object.assign({}, insp(r1).data.linkedCommentBadge);
        if (((p || 0).metadataBadgeRenderer || 0).trackingParams) {
          delete p.metadataBadgeRenderer.trackingParams;
        }
        return p;
      }

      /**
       * @param {ContentsRendererRef | null} v1
       * @param {ContentsRendererRef | null} v2
       * @returns {boolean}
       */
      function isSwappableContents(v1, v2) {
        if (!(v1 && v2)) return false;
        return (
          v1.parent === v2.parent &&
          (v2.parent.nodeName === 'YTD-COMMENTS' ||
            v2.parent.nodeName === 'YTD-ITEM-SECTION-RENDERER')
        );
      }

      /** Move the target contents entry to the front so the swap reads it first. @param {ContentsRendererRef} v2 */
      function promoteTargetContents(v2) {
        const v2pCnt = insp(v2.parent);
        /** @type {unknown[]} */ const v2Conents = (v2pCnt.data || 0).contents || 0;
        if (!v2Conents) _ll.warn('v2Conents is not found');

        v2pCnt.data = Object.assign({}, v2pCnt.data, {
          contents: /** @type {unknown[]} */ ([]).concat(
            [v2Conents[v2.index]],
            v2Conents.slice(0, v2.index),
            v2Conents.slice(v2.index + 1)
          ),
        });
      }

      /**
       * @param {ContentsRendererRef | null} v2
       * @param {string} targetLcId
       * @param {string} currentLcId
       * @param {unknown} p
       * @returns {boolean}
       */
      function applyLcSwap(v2, targetLcId, currentLcId, p) {
        if (!v2) return false;
        if (v2.index < 0) return false;
        if (v2.parent.nodeName !== 'YTD-COMMENT-REPLIES-RENDERER') promoteTargetContents(v2);
        return lcSwapFuncB(targetLcId, currentLcId, p);
      }

      /**
       * @param {string} targetLcId
       * @param {string} currentLcId
       */
      function lcSwapFuncA(targetLcId, currentLcId) {
        let done = 0;
        try {
          const found1 = findLcComment(currentLcId);
          const found2 = findLcComment(targetLcId);
          if (!(found1 && found2)) return false;
          const r1 = found1.commentRendererElm;
          const r2 = found2.commentRendererElm;

          if (
            typeof insp(r1).data.linkedCommentBadge === 'object' &&
            typeof insp(r2).data.linkedCommentBadge === 'undefined'
          ) {
            const p = cloneLinkedCommentBadge(r1);
            const v1 = findContentsRenderer(r1);
            const v2 = findContentsRenderer(r2);
            if (!isSwappableContents(v1, v2)) return false;
            if (applyLcSwap(v2, targetLcId, currentLcId, p)) done = 1;
          }
        } catch (e) {
          logS(e);
          _ll.warn(e);
        }
        return done === 1;
      }

      /**
       * @param {unknown} _p
       * @param {string} currentLcId
       * @param {string} targetLcId
       */
      function lcSwapFuncB(targetLcId, currentLcId, _p) {
        let done = 0;
        try {
          const found1 = findLcComment(currentLcId);
          const found2 = findLcComment(targetLcId);
          if (!(found1 && found2)) return false;
          const r1 = found1.commentRendererElm;
          const r1cnt = insp(r1);
          const r2 = found2.commentRendererElm;
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
          logS(e);
          _ll.warn(e);
        }
        return done === 1;
      }

      /** @param {Element} media */
      function pauseIfPlayingMedia(media) {
        Promise.resolve(media)
          .then((/** @type {HTMLMediaElement} */ el) => el.paused === false && el.pause())
          .catch(_ll.warn);
      }

      /**
       * Pause whichever other media element is still playing.
       * @param {Element} newMedia
       * @param {Element} media1
       * @param {Iterable<Element>} media2
       */
      function pauseOtherPlayingMedia(newMedia, media1, media2) {
        if (newMedia !== media1 && /** @type {HTMLMediaElement} */ (media1).paused === false) {
          if (isVideoPlaying(/** @type {HTMLMediaElement} */ (media1)))
            pauseIfPlayingMedia(newMedia);
          return;
        }
        if (newMedia === media1) {
          for (const s of media2) {
            if (/** @type {HTMLMediaElement} */ (s).paused === false) {
              pauseIfPlayingMedia(s);
              break;
            }
          }
          return;
        }
        pauseIfPlayingMedia(media1);
      }

      /**
       * @param {Event} evt
       */
      const loadStartFx = async evt => {
        const media = evt?.target instanceof HTMLMediaElement ? evt.target : null;
        if (!media || (media.nodeName !== 'VIDEO' && media.nodeName !== 'AUDIO')) return;

        const media1 = common.getMediaElement(0); // document.querySelector('#movie_player video[src]');
        const media2 = common.getMediaElements(2); // document.querySelectorAll('ytd-browse[role="main"] video[src]');

        if (media1 !== null && media2.length > 0) pauseOtherPlayingMedia(media, media1, media2);
      };

      /**
       * @param {YtNavigationEndpoint | null | undefined} endpoint
       * @returns {{ videoId: string, url: string, targetLcId: string } | null}
       */
      function parseLinkedCommentEndpoint(endpoint) {
        if (!(endpoint?.commandMetadata?.webCommandMetadata && endpoint.watchEndpoint)) return null;
        const videoId = endpoint.watchEndpoint.videoId;
        const url = endpoint.commandMetadata.webCommandMetadata.url;
        if (typeof videoId !== 'string' || typeof url !== 'string' || url.indexOf('lc=') <= 0)
          return null;
        const m = /^\/watch\?v=([\w_-]+)&lc=([\w_.-]+)$/.exec(url); // dot = sub-comment
        if (!m || m[1] !== videoId) return null;
        return { videoId, url, targetLcId: m[2] };
      }

      /**
       * Linked-comment (lc=) watch navigation: if the target comment is
       * already rendered in place, just fix the URL (replaceState) and
       * signal "handled" by returning true.
       * @param {YtNavigationEndpoint | null | undefined} endpoint
       * @returns {boolean} true when the URL swap fully handled the request
       */
      const trySwapLinkedComment = endpoint => {
        const parsed = parseLinkedCommentEndpoint(endpoint);
        if (!parsed) return false;
        const targetLc = findLcComment(parsed.targetLcId);
        const currentLc = targetLc ? findLcComment() : null;
        if (!(targetLc && currentLc)) return false;
        let done = targetLc.lc === currentLc.lc;
        if (!done) done = lcSwapFuncA(targetLc.lc, currentLc.lc);
        if (!done) return false;
        common.xReplaceState(history.state, parsed.url);
        return true;
      };

      /**
       * Decide whether a browse/search endpoint is valid to keep.
       * @param {YtNavigationEndpoint | null | undefined} endpoint
       * @returns {boolean}
       */
      const isBrowsableBrowseEndpoint = endpoint => {
        if (
          endpoint?.commandMetadata?.webCommandMetadata &&
          endpoint.browseEndpoint &&
          isChannelId(endpoint.browseEndpoint.browseId)
        ) {
          return true;
        }
        if (
          !(endpoint && (endpoint.browseEndpoint || endpoint.searchEndpoint)) ||
          endpoint.urlEndpoint ||
          endpoint.watchEndpoint
        ) {
          return false;
        }
        if (endpoint.browseEndpoint && endpoint.browseEndpoint.browseId === 'FEwhat_to_watch') {
          const playerMedia = /** @type {HTMLMediaElement | null} */ (common.getMediaElement(1));
          return Boolean(playerMedia && playerMedia.paused === false); // home page
        }
        const meta = endpoint.commandMetadata?.webCommandMetadata;
        return Boolean(meta?.url && meta.webPageType);
      };

      /**
       * @param {{ command?: YtNavigationEndpoint }} req
       */
      const getBrowsableEndPoint = req => {
        const endpoint = req ? req.command : null;
        if (trySwapLinkedComment(endpoint)) return;
        const valid = isBrowsableBrowseEndpoint(endpoint);
        return valid ? endpoint : null;
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
          const media = /** @type {HTMLMediaElement | null} */ (
            qsOne(movie_player, 'video[class], audio[class]')
          );
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
      };

      /**
       * @param {{ command?: YtNavigationEndpoint }} req
       */
      const conditionFulfillment = req => {
        const command = req ? req.command : null;
        if (!command) return;

        const meta = command.commandMetadata;
        const isWatch = Boolean(meta?.webCommandMetadata && command.watchEndpoint);
        const isChannel = Boolean(
          meta?.webCommandMetadata &&
            command.browseEndpoint &&
            isChannelId(command.browseEndpoint.browseId)
        );
        const isBrowseOrSearch = Boolean(
          (command.browseEndpoint || command.searchEndpoint) &&
            !command.urlEndpoint &&
            !command.watchEndpoint
        );
        if (!(isWatch || isChannel || isBrowseOrSearch)) return false;

        if (!shouldUseMiniPlayer()) return false;

        if (pageType !== 'watch') return false;

        // 2025.10.16 - ignore ytp-miniplayer-button existance
        return true;
      };

      let u38 = 0;
      /** @returns {boolean} whether no visible about popup is open */
      function isAboutPopupClosed() {
        const currentAbout = [...document.querySelectorAll('ytd-about-channel-renderer')].filter(
          e => !e.closest('[hidden]')
        )[0];
        if (!currentAbout) return true;
        const popupContainer = currentAbout.closest('ytd-popup-container');
        if (!popupContainer) return false;
        const cnt = insp(popupContainer);
        let arr = null;
        try {
          arr = cnt.handleGetOpenedPopupsAction_();
        } catch (_e) {
          logS(_e);
          _ll.warn('handleGetOpenedPopupsAction_ failed', _e);
        }
        return Boolean(arr && arr.length === 0);
      }

      /** Click the description toggle when its about popup is closed. */
      function openChannelAboutDescription() {
        const descriptionModel = [
          ...document.querySelectorAll('yt-description-preview-view-model'),
        ].filter(e => !e.closest('[hidden]'))[0];
        if (!descriptionModel) return;
        const button = [...descriptionModel.querySelectorAll('button')].filter(
          e => !e.closest('[hidden]') && `${e.textContent}`.trim().length > 0
        )[0];
        if (button) button.click();
      }

      /** @param {number} t38 */
      const fixChannelAboutPopup = async t38 => {
        /** @type {InstanceType<typeof PromiseExternal> | null} */ let promise =
          new PromiseExternal();
        const f = () => {
          promise?.resolve();
          promise = null;
        };
        _registerListener(document, 'yt-navigate-finish', f, false, true);
        await promise?.then();
        promise = null;
        document.removeEventListener('yt-navigate-finish', f, false);
        if (t38 !== u38) return;
        setTimeout(() => {
          if (isAboutPopupClosed()) openChannelAboutDescription();
        }, 80);
      };
      /**
       * Define a throwaway `playlistId` getter that resolves once the page type
       * changes (or after 4s), so the navigation can read it without blocking.
       * @param {unknown} object
       */
      function awaitPlaylistIdResolution(object) {
        let wObject = mWeakRef(object);
        const N = 3;
        let count = 0;

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

        const once = { once: true }; // browsers supporting async function can also use once option.
        /** @type {(() => void) | null} */ let playlistClearout = null;

        let timeoutid = 0;
        Promise.race([
          new Promise((/** @type {(value?: unknown) => void} */ r) => {
            timeoutid = /** @type {number} */ (/** @type {unknown} */ (setTimeout_(r, 4000)));
          }),
          new Promise((/** @type {(value?: unknown) => void} */ r) => {
            playlistClearout = () => {
              if (timeoutid > 0) {
                clearTimeout(timeoutid);
                timeoutid = 0;
              }
              r();
            };
            _registerListener(document, 'yt-page-type-changed', playlistClearout, once, true);
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
            const resolved = kRef(wObject);
            wObject = null;
            return resolved ? resolved.playlistId : null;
          })
          .catch(_ll.warn);
      }

      /**
       * @param {Element} ytdAppCnt
       * @returns {{ videoId?: string } | null}
       */
      function readCurrentWatchEndpoint(ytdAppCnt) {
        try {
          const data =
            /** @type {{ response?: { currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } } } }} */ (
              /** @type {YtPolymerElement} */ (ytdAppCnt).data
            );
          return data.response?.currentVideoEndpoint?.watchEndpoint || null;
        } catch (_e) {
          logS(_e);
          return null;
        }
      }

      function ensureLoadStartListener() {
        if (isLoadStartListened) return;
        isLoadStartListened = true;
        _registerListener(document, 'loadstart', loadStartFx, true, true);
      }

      /**
       * @param {YtNavigationEndpoint | null | undefined} endpoint
       * @param {number} t38
       */
      function maybeFixChannelAboutPopup(endpoint, t38) {
        const endpointURL = `${endpoint?.commandMetadata?.webCommandMetadata?.url || ''}`;
        if (
          endpointURL?.endsWith('/about') &&
          /\/channel\/UC[-_a-zA-Z0-9+=.]{22}\/about/.test(endpointURL)
        ) {
          fixChannelAboutPopup(t38);
        }
      }

      /** @param {{ apply: (thisArg: unknown, args: unknown) => void }} handleNavigate */
      const handleNavigateFactory = handleNavigate => {
        /**
         * @this {YtProto}
         * @param {{ command?: YtNavigationEndpoint }} req
         */
        return function (req) {
          if (u38 > 1e9) u38 = 9;
          const t38 = ++u38;

          const $arguments = arguments;

          let endpoint = null;

          if (conditionFulfillment(req)) {
            endpoint = getBrowsableEndPoint(req);
          }

          if (!(endpoint && shouldUseMiniPlayer())) return handleNavigate.apply(this, $arguments);

          const rawEndpoint = readCurrentWatchEndpoint(insp(document.querySelector('ytd-app')));
          const object = typeof rawEndpoint === 'object' ? rawEndpoint : null;
          if (object && !('playlistId' in object)) awaitPlaylistIdResolution(object);

          ensureLoadStartListener();
          maybeFixChannelAboutPopup(endpoint, t38);

          handleNavigate.apply(this, $arguments);
        };
      };

      return { handleNavigateFactory };
    })();

    function buildCommon() {
      let mediaModeLock = 0;

      /** @param {string} sel */
      const queryMedia = sel => {
        const cache = window.YouTubePlusDOMCache;
        return cache?.querySelector ? cache.querySelector(sel) : document.querySelector(sel);
      };

      /** @returns {1|2|0} video / audio / undetected */
      function detectMediaMode() {
        const el =
          queryMedia('.video-stream.html5-main-video') ||
          queryMedia('#movie_player video, #movie_player audio') ||
          queryMedia('body video[src], body audio[src]');
        if (!el) return 0;
        if (el.nodeName === 'VIDEO') return 1;
        if (el.nodeName === 'AUDIO') return 2;
        return 0;
      }

      // Per media mode: the selector for `i` (1, 2) and the default (0).
      /** @type {Record<number, Record<number, string>>} */
      const MEDIA_SELECTORS = {
        1: {
          0: '#movie_player video[src]',
          1: 'ytd-player#ytd-player video[src]',
          2: 'ytd-browse[role="main"] video[src]',
        },
        2: {
          0: '#movie_player audio.video-stream.html5-main-video[src]',
          1: 'ytd-player#ytd-player audio.video-stream.html5-main-video[src]',
          2: 'ytd-browse[role="main"] audio.video-stream.html5-main-video[src]',
        },
      };

      /**
       * @param {number} i
       */
      const _getMediaElement = i => {
        if (mediaModeLock === 0) mediaModeLock = detectMediaMode();
        if (!mediaModeLock) return null;
        const table = MEDIA_SELECTORS[mediaModeLock];
        return table[i] || table[0];
      };

      return {
        /**
         * @param {{ endpoint?: unknown }} s
         * @param {string | URL | null} u
         */
        xReplaceState(s, u) {
          try {
            history.replaceState(s, '', u);
          } catch (_e) {
            logS(_e);
            // in case error occurs if replaceState is replaced by any external script / extension
          }
          if (s.endpoint) {
            try {
              const cache = window.YouTubePlusDOMCache;
              const ytdAppElm = cache?.querySelector
                ? cache.querySelector('ytd-app')
                : document.querySelector('ytd-app');
              const ytdAppCnt = insp(ytdAppElm);
              ytdAppCnt.replaceState(s.endpoint, '', u);
            } catch (_e) {
              logS(_e);
              _ll.warn('replaceState failed', _e);
            }
          }
        },
        /**
         * @param {number} i
         */
        getMediaElement(i) {
          const s = _getMediaElement(i) || '';
          if (s) {
            const cache = window.YouTubePlusDOMCache;
            return cache?.querySelector ? cache.querySelector(s) : document.querySelector(s);
          }
          return null;
        },
        /**
         * @param {number} i
         */
        getMediaElements(i) {
          const s = _getMediaElement(i) || '';
          if (s) {
            const cache = window.YouTubePlusDOMCache;
            return cache?.querySelectorAll
              ? cache.querySelectorAll(s)
              : document.querySelectorAll(s);
          }
          return [];
        },
      };
    }

    const common = buildCommon();

    let inPageRearrange = false;
    let tmpLastVideoId = '';

    const getCurrentVideoId = () => {
      const ytdFlexyElm = elements.flexy;
      const ytdFlexyCnt = insp(ytdFlexyElm);
      if (ytdFlexyCnt && typeof ytdFlexyCnt.videoId === 'string') return ytdFlexyCnt.videoId;
      if (ytdFlexyElm && typeof ytdFlexyElm.videoId === 'string') return ytdFlexyElm.videoId;
      _ll.info('video id not found');
      return '';
    };

    /**
     * @param {YtProto} inlineExpanderCnt
     */
    const fixInlineExpanderDisplay = inlineExpanderCnt => {
      for (const method of [
        'updateIsAttributedExpanded',
        'updateIsFormattedExpanded',
        'updateTextOnSnippetTypeChange',
        'updateStyles',
      ]) {
        try {
          inlineExpanderCnt[method]();
        } catch (_e) {
          logS(_e);
          _ll.warn(`${method} failed`, _e);
        }
      }
    };

    /**
     * @param {YtProto} cnt
     */
    const setExpand = (cnt, /** @type {unknown} */ _flag) => {
      if (typeof cnt.set === 'function') {
        cnt.set('isExpanded', true);
        if (typeof cnt.isExpandedChanged === 'function') cnt.isExpandedChanged();
      } else if (cnt.isExpanded === false) {
        cnt.isExpanded = true;
        if (typeof cnt.isExpandedChanged === 'function') cnt.isExpandedChanged();
      }
    };

    /**
     * Inline-expander method shim installed on the YouTube element controller.
     * @typedef {object} InlineExpanderShim
     * @property {unknown} [isResetMutation]
     * @property {unknown} [isExpanded]
     * @property {(this: InlineExpanderShim) => void} updateTextOnSnippetTypeChange
     * @property {() => void} collapse
     * @property {() => number} computeExpandButtonOffset
     * @property {() => void} dataChanged
     */
    /** @type {InlineExpanderShim} */
    const cloneMethods = {
      updateTextOnSnippetTypeChange() {
        if (this.isResetMutation === false) this.isResetMutation = true;
        if (this.isExpanded === true) this.isExpanded = false;
        setExpand(this, true);
        if (this.isResetMutation === false) this.isResetMutation = true;
      },
      collapse() {},
      computeExpandButtonOffset() {
        return 0;
      },
      dataChanged() {},
    };
    /**
     * @param {YtProto} inlineExpanderCnt
     */
    const fixInlineExpanderMethods = inlineExpanderCnt => {
      if (inlineExpanderCnt && !inlineExpanderCnt.__$$idncjk8487$$__) {
        inlineExpanderCnt.__$$idncjk8487$$__ = true;
        inlineExpanderCnt.dataChanged = cloneMethods.dataChanged;
        inlineExpanderCnt.updateTextOnSnippetTypeChange =
          cloneMethods.updateTextOnSnippetTypeChange;
        if (typeof inlineExpanderCnt.collapse === 'function') {
          inlineExpanderCnt.collapse = cloneMethods.collapse;
        }
        if (typeof inlineExpanderCnt.computeExpandButtonOffset === 'function') {
          inlineExpanderCnt.computeExpandButtonOffset = cloneMethods.computeExpandButtonOffset;
        }
        if (typeof inlineExpanderCnt.isResetMutation === 'boolean') {
          inlineExpanderCnt.isResetMutation = true;
        }
        if (typeof inlineExpanderCnt.collapseLabel === 'string') {
          inlineExpanderCnt.collapseLabel = '';
        }
        fixInlineExpanderDisplay(inlineExpanderCnt); // do the initial fix
      }
    };

    const fixInlineExpanderContent = () => {
      const mainInfo = getMainInfo();
      if (!mainInfo) return;

      const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
      const inlineExpanderCnt = insp(inlineExpanderElm);
      fixInlineExpanderMethods(inlineExpanderCnt);
    };

    /** @type {Record<string, any>} */
    const plugin = {
      minibrowser: {
        activated: false,
        toUse: true, // depends on shouldUseMiniPlayer()
        activate() {
          if (this.activated) return;

          const isPassiveArgSupport = typeof IntersectionObserver === 'function';
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
        /**
         * @param {number} lockId
         */
        moFn(lockId) {
          if (lockGet.autoExpandInfoDescAttrAsyncLock !== lockId) return;

          const mainInfo = getMainInfo();

          if (!mainInfo) return;
          switch (((mainInfo || 0).nodeName || '').toLowerCase()) {
            case 'ytd-expander':
              if (mainInfo.hasAttribute000('collapsed')) {
                let success = false;
                try {
                  insp(mainInfo).handleMoreTap(new Event('tap'));
                  success = true;
                } catch (_e) {
                  logS(_e);
                  _ll.warn('handleMoreTap failed', _e);
                }
                if (success) mainInfo.setAttribute111('tyt-no-less-btn', '');
              }
              break;
            case 'ytd-expandable-video-description-body-renderer': {
              const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
              const inlineExpanderCnt = insp(inlineExpanderElm);
              if (inlineExpanderCnt && inlineExpanderCnt.isExpanded === false) {
                setExpand(inlineExpanderCnt, true);
              }
              break;
            }
          }
        },
        activate() {
          if (this.activated) return;

          this.moFn = this.moFn.bind(this);
          this.moSubId = null;
          this.moCallback = () => {
            Promise.resolve(lockSet.autoExpandInfoDescAttrAsyncLock)
              .then(this.moFn)
              .catch(_ll.warn);
          };
          this.activated = true;
          this.promiseReady.resolve();
        },
        /**
         * @param {Element} mainInfo
         */
        async onMainInfoSet(mainInfo) {
          await this.promiseReady.then();
          const isExpander = mainInfo.nodeName.toLowerCase() === 'ytd-expander';
          this.moSubId = observeTarget({ id: this.moSubId }, mainInfo, this.moCallback, {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: isExpander ? ['collapsed', 'attr-8ifv7'] : ['attr-8ifv7'],
          });
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
        /** @type {Element | null} */
        roTarget: null,
        promiseReady: new PromiseExternal(),
        checkResize: 0,
        /**
         * @param {Event} evt
         */
        mouseEnterFn(evt) {
          const metaDataElm = getHoveredMetaData(evt);
          if (!metaDataElm) return;
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          this.checkResize = Date.now() + 300;
          metaDataElm.classList.add('tyt-metadata-hover');
        },
        /**
         * @param {Event} evt
         */
        mouseLeaveFn(evt) {
          const metaDataElm = getHoveredMetaData(evt);
          if (!metaDataElm) return;
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          metaDataElm.classList.remove('tyt-metadata-hover');
        },
        /**
         * @param {number} lockId
         */
        moFn(lockId) {
          if (lockGet.fullChannelNameOnHoverAttrAsyncLock !== lockId) return;

          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;

          const evtOpt = { passive: true, capture: false };
          uploadInfo.removeEventListener('pointerenter', this.mouseEnterFn, evtOpt);
          uploadInfo.removeEventListener('pointerleave', this.mouseLeaveFn, evtOpt);

          _registerListener(uploadInfo, 'pointerenter', this.mouseEnterFn, evtOpt, false);
          _registerListener(uploadInfo, 'pointerleave', this.mouseLeaveFn, evtOpt, false);
        },
        async onNavigateFinish() {
          await this.promiseReady.then();
          const uploadInfo = document.querySelector(
            '#primary.ytd-watch-flexy ytd-watch-metadata #upload-info'
          );
          if (!uploadInfo) return;
          this.moSubId = observeTarget({ id: this.moSubId }, uploadInfo, this.moCallback, {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['hidden', 'attr-3wb0k'],
          });
          uploadInfo.incAttribute111('attr-3wb0k');
          if (this.roTarget && this.roTarget !== uploadInfo) this.ro.unobserve(this.roTarget);
          this.roTarget = uploadInfo;
          this.ro.observe(uploadInfo);
        },
        activate() {
          if (this.activated) return;

          const isPassiveArgSupport = typeof IntersectionObserver === 'function';
          // https://caniuse.com/?search=observer
          // https://caniuse.com/?search=addEventListener%20passive

          if (!isPassiveArgSupport) return;

          this.activated = true;

          this.mouseEnterFn = this.mouseEnterFn.bind(this);
          this.mouseLeaveFn = this.mouseLeaveFn.bind(this);

          this.moFn = this.moFn.bind(this);
          this.moSubId = null;
          this.moCallback = () => {
            Promise.resolve(lockSet.fullChannelNameOnHoverAttrAsyncLock)
              .then(this.moFn)
              .catch(_ll.warn);
          };
          this.ro = _registerObserver(
            new ResizeObserver(mutations => {
              if (Date.now() > this.checkResize) return;
              for (const mutation of mutations) {
                const uploadInfo = mutation.target;
                if (
                  uploadInfo &&
                  mutation.contentRect.width > 0 &&
                  mutation.contentRect.height > 0
                ) {
                  const metaDataElm = uploadInfo.closest('ytd-watch-metadata');
                  if (metaDataElm?.classList.contains('tyt-metadata-hover')) {
                    metaDataElm.classList.add('tyt-metadata-hover-resized');
                  }

                  break;
                }
              }
            }),
            null,
            { scope: 'session' }
          );
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

    const __attachedSymbol__ = Symbol();

    /**
     * @param {string} tag
     */
    const makeInitAttached = tag => {
      const inPageRearrange_ = inPageRearrange;
      inPageRearrange = false;
      for (const elm of document.querySelectorAll(`${tag}`)) {
        const cnt = insp(elm) || 0;
        if (
          typeof cnt.attached498 === 'function' &&
          !(/** @type {YtProto} */ (elm)[__attachedSymbol__])
        )
          Promise.resolve(elm).then(eventMap[`${tag}::attached`]).catch(_ll.warn);
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
          _ll.info('ytd-live-chat-frame::attached - delayPn(200)');
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
        document.querySelector('ytd-watch-flexy')?.appendChild(nsTemplate);
      }
      return nsTemplate;
    };

    /**
     * @param {string} selector
     * @param {Element} elm
     */
    const isPageDOM = (elm, selector) => {
      if (!(elm && elm instanceof Element && elm.nodeName)) return false;
      if (!elm.closest(selector)) return false;
      if (elm.isConnected !== true) return false;
      return true;
    };

    /**
     * @param {HTMLElement} hostElement
     */
    const invalidFlexyParent = hostElement => {
      if (hostElement instanceof HTMLElement) {
        const hasFlexyParent = HTMLElement.prototype.closest.call(hostElement, 'ytd-watch-flexy'); // eg short
        if (!hasFlexyParent) return true;
        const currentFlexy = elements.flexy;
        if (currentFlexy && currentFlexy !== hasFlexyParent) return true;
      }
      return false;
    };

    // Shared entry guards for eventMap's `*::attached` / `*::detached`
    // handlers below. Every handler repeated the same boilerplate check
    // inline (9 attached + 9 detached sites) before doing its own
    // element-specific work; factored out here verbatim: same
    // conditions, same short-circuit order, same __attachedSymbol__
    // side effect in the attached guard. Does not change which handler
    // calls invalidFlexyParent() first (that varies per site and is
    // left as-is at each call site).
    /**
     * @param {HTMLElement} hostElement
     */
    const isValidAttachedHost = hostElement => {
      if (hostElement instanceof Element)
        /** @type {YtProto} */ (hostElement)[__attachedSymbol__] = true;
      if (
        !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
        hostElement.closest('noscript')
      ) {
        return false;
      }
      return hostElement.isConnected === true;
    };
    /**
     * @param {HTMLElement} hostElement
     */
    const isValidDetachedHost = hostElement => {
      if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return false;
      return hostElement.isConnected === false;
    };

    /** @type {string | null} */
    let headerMutationSubId = null;
    /** @type {Element | null} */ let headerMutationTmpNode = null;
    /** @type {string | null} */
    let inlineExpanderSubId = null;
    /** @type {string | null} */
    let aoFlexySubId = null;
    /** @type {string | null} */
    let moEgmPanelReadySubId = null;

    // --- Helper: resolve YTLSTM external plugin special cases ---
    /** @param {number} p @param {number} q @returns {number} */
    const resolveYtlstmSpecial = (p, q) => {
      if (!plugin['external.ytlstm'].activated) return 0;
      if (q & FLAG.FULLSCREEN) return 0;
      if (
        (p &
          (FLAG.THEATER |
            FLAG.TAB_SELECTED |
            FLAG.CHAT_COLLAPSED |
            FLAG.CHAT_EXPANDED |
            FLAG.TWO_COLUMNS |
            FLAG.EXTERNAL_YTLSTM)) ===
          (FLAG.THEATER | 0 | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS | FLAG.EXTERNAL_YTLSTM) &&
        (q &
          (FLAG.THEATER |
            FLAG.TAB_SELECTED |
            FLAG.CHAT_COLLAPSED |
            FLAG.CHAT_EXPANDED |
            FLAG.TWO_COLUMNS |
            FLAG.EXTERNAL_YTLSTM)) ===
          (FLAG.THEATER | 0 | FLAG.CHAT_COLLAPSED | 0 | FLAG.TWO_COLUMNS | FLAG.EXTERNAL_YTLSTM)
      ) {
        return 3;
      }
      if (
        (q & (FLAG.THEATER | FLAG.TWO_COLUMNS)) === (FLAG.THEATER | FLAG.TWO_COLUMNS) &&
        document.querySelector('[data-ytlstm-theater-mode]')
      ) {
        return 1;
      }
      if (
        (q & (FLAG.THEATER | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS)) ===
          (FLAG.THEATER | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS) &&
        document.querySelector('[is-two-columns_][theater][tyt-chat="+"]')
      ) {
        return 2;
      }
      return 0;
    };

    // --- Helper: track panel open/close state ---
    /** @param {number} p @param {number} q @param {number} special @returns {{resetForPanelDisappeared:boolean}} */
    const updateLastPanel = (p, q, special) => {
      let resetForPanelDisappeared = false;
      if (special) return { resetForPanelDisappeared };
      if ((p & FLAG.PLAYLIST) === 0 && (q & FLAG.PLAYLIST) === FLAG.PLAYLIST) {
        lastPanel = 'playlist';
      } else if (
        (p & FLAG.CHAT_EXPANDED) === 0 &&
        (q & FLAG.CHAT_EXPANDED) === FLAG.CHAT_EXPANDED
      ) {
        lastPanel = 'chat';
      } else if (
        (((p & FLAG.CHAT_COLLAPSED) === FLAG.CHAT_COLLAPSED &&
          (q & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === (0 | 0)) ||
          ((p & FLAG.CHAT_EXPANDED) === FLAG.CHAT_EXPANDED &&
            (q & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === (0 | 0))) &&
        lastPanel === 'chat'
      ) {
        lastPanel = lastTab || '';
        resetForPanelDisappeared = true;
      } else if (
        (p & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === FLAG.CHAT_EXPANDED &&
        (q & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === FLAG.CHAT_COLLAPSED &&
        lastPanel === 'chat'
      ) {
        lastPanel = lastTab || '';
        resetForPanelDisappeared = true;
      } else if (
        (p & FLAG.PLAYLIST) === FLAG.PLAYLIST &&
        (q & FLAG.PLAYLIST) === 0 &&
        lastPanel === 'playlist'
      ) {
        lastPanel = lastTab || '';
        resetForPanelDisappeared = true;
      }
      return { resetForPanelDisappeared };
    };

    // --- Helper: execute special YTLSTM dispatch actions ---
    /** @param {number} special @param {Element} ytdFlexyElm @returns {boolean} true if handled */
    const dispatchSpecialAction = (special, ytdFlexyElm) => {
      if (special === 1) {
        if (ytdFlexyElm.getAttribute('tyt-chat') !== '+') {
          ytBtnExpandChat();
        }
        if (ytdFlexyElm.getAttribute('tyt-tab')) {
          switchToTab(null);
        }
        return true;
      }
      if (special === 2) {
        ytBtnCollapseChat();
        return true;
      }
      if (special === 3) {
        ytBtnCancelTheater();
        if (lastTab) {
          switchToTab(lastTab);
        }
        return true;
      }
      return false;
    };

    // --- Helper: handle tab/playlist/two-column transitions ---
    // One rule per known transition; each rule fires at most once per call.
    /** @type {Array<{ when: (p: number, q: number) => boolean, run: () => void }>} */
    const TAB_TRANSITIONS = [
      {
        when: (p, q) =>
          (p & FLAG.TAB_SELECTED) === 0 &&
          (q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED &&
          (p & FLAG.PLAYLIST) === FLAG.PLAYLIST &&
          (q & FLAG.PLAYLIST) === FLAG.PLAYLIST,
        run: () => {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
        },
      },
      {
        when: (p, q) =>
          (p & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST) &&
          (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST) &&
          lastPanel === 'chat',
        run: () => {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
        },
      },
      {
        when: (p, q) =>
          (p & FLAG.ALL_STANDARD) ===
            (FLAG.THEATER | FLAG.TAB_SELECTED | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS) &&
          (q & FLAG.ALL_STANDARD) ===
            (0 | FLAG.TAB_SELECTED | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS),
        run: () => {
          lastPanel = lastTab || '';
          ytBtnCollapseChat();
        },
      },
      {
        when: (p, q) =>
          (p & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (FLAG.TAB_SELECTED | 0) &&
          (q & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (FLAG.TAB_SELECTED | FLAG.PLAYLIST) &&
          lastPanel === 'playlist',
        run: () => {
          switchToTab(null);
        },
      },
      {
        when: (p, q) =>
          (p & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | 0) &&
          (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST) &&
          lastPanel === 'playlist',
        run: () => {
          lastPanel = lastTab || '';
          ytBtnCollapseChat();
        },
      },
      {
        when: (p, q) =>
          (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
            (FLAG.THEATER | FLAG.TWO_COLUMNS) &&
          (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
            (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST),
        run: () => {
          ytBtnCancelTheater();
        },
      },
      {
        when: (p, q) =>
          (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
            (FLAG.TWO_COLUMNS | FLAG.PLAYLIST) &&
          (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
            (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST),
        run: () => {
          lastPanel = lastTab || '';
          ytBtnClosePlaylist();
        },
      },
    ];

    /** @param {number} p @param {number} q @returns {{actioned:boolean, bFixForResizedTab:boolean}} */
    const handleTabPlaylistTransitions = (p, q) => {
      let actioned = false;
      let bFixForResizedTab = false;

      if ((q ^ FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED && bFixForResizedTabLater) {
        bFixForResizedTab = true;
      }

      if ((p & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS && (q & FLAG.TWO_COLUMNS) === 0) {
        Promise.resolve(lockSet.twoColumnChanged10Lock)
          .then(eventMap.twoColumnChanged10)
          .catch(_ll.warn);
      }

      if (
        ((p & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) !==
          ((q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) &&
        (q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED
      ) {
        bFixForResizedTab = true;
      }

      for (const rule of TAB_TRANSITIONS) {
        if (rule.when(p, q)) {
          rule.run();
          actioned = true;
        }
      }

      return { actioned, bFixForResizedTab };
    };

    // --- Helper: handle fullscreen enter/exit transitions ---
    /** @param {number} p @param {number} q @param {boolean} prevActioned @returns {{actioned:boolean}} */
    // --- Helper: fullscreen transition masks ---
    /** @param {number} p @param {number} q @param {number} pMask @param {number} qMask @returns {boolean} */
    const maskIs = (p, q, pMask, qMask) => (p & pMask) === pMask && (q & qMask) === qMask;

    /** @param {number} p @param {number} q @param {boolean} actioned @returns {boolean} */
    const onFullscreenExit = (p, q, actioned) => {
      if ((q & FLAG.ENGAGEMENT_PANEL) === FLAG.ENGAGEMENT_PANEL) {
        ytBtnCloseEngagementPanels();
      }
      if (
        maskIs(p, q, FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED, FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)
      ) {
        if (lastPanel === 'chat') {
          switchToTab(null);
          return true;
        } else if (lastPanel) {
          ytBtnCollapseChat();
          return true;
        }
      }
      return actioned;
    };

    /** @param {number} p @param {number} q @returns {boolean} */
    const onTheaterEnter = (p, q) => {
      if ((q & FLAG.ENGAGEMENT_PANEL) === FLAG.ENGAGEMENT_PANEL) {
        ytBtnCloseEngagementPanels();
      }
      if (maskIs(p, q, FLAG.THEATER | FLAG.CHAT_EXPANDED, FLAG.THEATER | FLAG.CHAT_EXPANDED)) {
        ytBtnCollapseChat();
      }
      switchToTab(null);
      return true;
    };

    // --- Helper: fullscreen/theater transition chain (first match wins) ---
    /** @type {Array<{ when: (ctx: { p: number, q: number }) => boolean, run: (ctx: { p: number, q: number, actioned: boolean }) => boolean }>} */
    const FULLSCREEN_TRANSITIONS = [
      { when: ({ q }) => (q & FLAG.FULLSCREEN) === FLAG.FULLSCREEN, run: () => false },
      {
        when: ({ p, q }) =>
          (p & FLAG.FULLSCREEN) === FLAG.FULLSCREEN && (q & FLAG.FULLSCREEN) === 0,
        run: ({ p, q, actioned }) => onFullscreenExit(p, q, actioned),
      },
      {
        when: ({ p, q }) =>
          (p &
            (FLAG.THEATER |
              FLAG.TAB_SELECTED |
              FLAG.CHAT_EXPANDED |
              FLAG.TWO_COLUMNS |
              FLAG.ENGAGEMENT_PANEL)) ===
            (FLAG.THEATER | 0 | 0 | FLAG.TWO_COLUMNS | 0) &&
          (q &
            (FLAG.THEATER |
              FLAG.TAB_SELECTED |
              FLAG.CHAT_EXPANDED |
              FLAG.TWO_COLUMNS |
              FLAG.ENGAGEMENT_PANEL)) ===
            (FLAG.THEATER | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS | 0),
        run: () => {
          ytBtnCancelTheater();
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL)) ===
            (0 | FLAG.TWO_COLUMNS | 0) &&
          (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL)) ===
            (0 | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL) &&
          (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) > 0,
        run: ({ q, actioned }) => {
          let next = actioned;
          if (q & FLAG.TAB_SELECTED) {
            switchToTab(null);
            next = true;
          }
          if (q & FLAG.CHAT_EXPANDED) {
            ytBtnCollapseChat();
            next = true;
          }
          return next;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED | FLAG.TAB_SELECTED)) ===
            (FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED) &&
          (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED | FLAG.TAB_SELECTED)) ===
            FLAG.TWO_COLUMNS &&
          (q & FLAG.PLAYLIST) === 0,
        run: ({ actioned }) => {
          if (lastTab) {
            switchToTab(lastTab);
            return true;
          }
          return actioned;
        },
      },
      {
        when: ({ p, q }) => (p & FLAG.THEATER) === 0 && (q & FLAG.THEATER) === FLAG.THEATER,
        run: ({ p, q }) => onTheaterEnter(p, q),
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.THEATER | FLAG.TAB_SELECTED)) === FLAG.THEATER &&
          (q & (FLAG.THEATER | FLAG.TAB_SELECTED)) === (FLAG.THEATER | FLAG.TAB_SELECTED),
        run: () => {
          ytBtnCancelTheater();
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) === FLAG.TAB_SELECTED &&
          (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) ===
            (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED),
        run: () => {
          switchToTab(null);
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL)) === (0 | FLAG.ENGAGEMENT_PANEL) &&
          (q & (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL)) ===
            (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL),
        run: () => {
          ytBtnCloseEngagementPanels();
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL)) === (0 | FLAG.ENGAGEMENT_PANEL) &&
          (q & (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL)) ===
            (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL),
        run: () => {
          ytBtnCloseEngagementPanels();
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) === (0 | FLAG.CHAT_EXPANDED) &&
          (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) ===
            (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED),
        run: () => {
          ytBtnCollapseChat();
          return true;
        },
      },
      {
        when: ({ p, q }) =>
          (p & FLAG.THEATER) === FLAG.THEATER &&
          (q & (FLAG.THEATER | FLAG.ENGAGEMENT_PANEL)) === (0 | 0),
        run: ({ actioned }) => {
          if (lastPanel === 'chat') {
            ytBtnExpandChat();
            return true;
          }
          if (lastPanel === lastTab && lastTab) {
            switchToTab(lastTab);
            return true;
          }
          return actioned;
        },
      },
    ];

    /** @param {number} p @param {number} q @param {boolean} prevActioned @returns {{actioned: boolean}} */
    const handleFullscreenTransitions = (p, q, prevActioned) => {
      let actioned = prevActioned;
      for (const rule of FULLSCREEN_TRANSITIONS) {
        const ctx = { p, q, actioned };
        if (rule.when(ctx)) {
          actioned = rule.run(ctx);
          break;
        }
      }
      return { actioned };
    };

    // --- Helper: playlist fallback + auto-fix logic ---
    /**
     * @param {number} p
     * @param {number} q
     * @param {boolean} actioned
     * @returns {boolean}
     */
    function needsAutoFix(p, q, actioned) {
      if (
        (p & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED &&
        (q & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST)
      ) {
        return false; // p->q -2
      }
      if (
        (p & FLAG.CHAT_EXPANDED) === FLAG.CHAT_EXPANDED &&
        (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST)
      ) {
        return false; // p->q -8
      }
      if (
        !actioned &&
        (p & (FLAG.THEATER | FLAG.TWO_COLUMNS)) === FLAG.TWO_COLUMNS &&
        (q &
          (FLAG.THEATER |
            FLAG.TWO_COLUMNS |
            FLAG.CHAT_EXPANDED |
            FLAG.TAB_SELECTED |
            FLAG.ENGAGEMENT_PANEL |
            FLAG.FULLSCREEN)) ===
          FLAG.TWO_COLUMNS
      ) {
        return true;
      }
      return (q & FLAG.ALL_STANDARD) === (FLAG.CHAT_COLLAPSED | FLAG.TWO_COLUMNS);
    }

    /**
     * Re-open whichever panel was last shown.
     * @param {boolean} resetForPanelDisappeared
     * @returns {boolean} true when an action was taken
     */
    function applyAutoFix(resetForPanelDisappeared) {
      if (lastPanel === 'chat') {
        _ll.info(388, 'd1c');
        ytBtnExpandChat();
        return true;
      }
      if (lastPanel === 'playlist') {
        _ll.info(388, 'd1p');
        ytBtnOpenPlaylist();
        return true;
      }
      if (lastTab) {
        _ll.info(388, 'd2t');
        switchToTab(lastTab);
        return true;
      }
      if (resetForPanelDisappeared) {
        _ll.info(388, 'd2d');
        Promise.resolve(lockSet.fixInitialTabStateLock)
          .then(eventMap.fixInitialTabStateFn)
          .catch(_ll.warn);
        return true;
      }
      return false;
    }

    /** @param {number} p @param {number} q @param {boolean} actioned @param {boolean} resetForPanelDisappeared @returns {{actioned:boolean}} */
    const handleAutoFix = (p, q, actioned, resetForPanelDisappeared) => {
      if (!actioned && (q & FLAG.PLAYLIST) === FLAG.PLAYLIST) {
        lastPanel = 'playlist';
        if ((q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) {
          switchToTab(null);
          actioned = true;
        }
      }

      if (needsAutoFix(p, q, actioned)) {
        _ll.info(388, 'd');
        if (applyAutoFix(resetForPanelDisappeared)) actioned = true;
      }

      return { actioned };
    };

    /**
     * Call a widget instance method when the element is upgraded and the method
     * exists. `warnLabel` logs a failure instead of letting it escape.
     * @param {Element} element
     * @param {string} method
     * @param {unknown} arg
     * @param {string} [warnLabel]
     */
    function callWidgetMethod(element, method, arg, warnLabel) {
      const cnt = insp(element);
      if (!(element instanceof HTMLElement_ && typeof cnt[method] === 'function')) return cnt;
      if (!warnLabel) {
        cnt[method](arg);
        return cnt;
      }
      try {
        cnt[method](arg);
      } catch (_e) {
        logS(_e);
        _ll.warn(warnLabel, _e);
      }
      return cnt;
    }

    /**
     * Register a freshly attached info renderer as the tab-info main info host.
     * @param {HTMLElement} hostElement
     * @returns {Promise<boolean>} false when the host went stale while waiting for the tabs
     */
    async function registerInfoExpanderMainInfo(hostElement) {
      elements.infoExpander = hostElement;
      _ll.info(128384, elements.infoExpander);

      infoExpanderElementProvidedPromise.resolve();
      hostElement.setAttribute111('tyt-main-info', '');
      if (plugin.autoExpandInfoDesc.toUse) {
        plugin.autoExpandInfoDesc.onMainInfoSet(hostElement);
      }

      const lockId = lockSet.rightTabReadyLock03;
      await rightTabsProvidedPromise.then();
      if (lockGet.rightTabReadyLock03 !== lockId) return false;

      if (elements.infoExpander !== hostElement) return false;
      if (hostElement.isConnected === false) return false;
      _ll.info(7932, 'infoExpander');

      elements.infoExpander.classList.add('tyt-main-info'); // add a classname for it

      const infoExpander = elements.infoExpander;
      const inlineExpanderElm = infoExpander.querySelector('ytd-text-inline-expander');
      if (inlineExpanderElm) {
        const onInlineExpanderMutation = () => {
          const p = document.querySelector('#tab-info ytd-text-inline-expander');
          sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__ = p?.hasAttribute('is-expanded')
            ? '1'
            : '';
          if (p) fixInlineExpanderContent();
        };
        inlineExpanderSubId = observeTarget(
          { id: inlineExpanderSubId },
          inlineExpanderElm,
          onInlineExpanderMutation,
          {
            attributes: true,
            childList: false,
            subtree: true,
            attributeFilter: ['is-expanded', 'attr-6v8qu', 'hidden'],
          }
        );
        inlineExpanderElm.incAttribute111('attr-6v8qu');
        const cnt = insp(inlineExpanderElm);

        if (cnt) fixInlineExpanderDisplay(cnt);
      }

      if (!infoExpander.closest('#right-tabs')) {
        document.querySelector('#tab-info')?.assignChildren111(null, infoExpander, null);
      } else {
        const tabBtn = document.querySelector('[tyt-tab-content="#tab-info"]');
        if (tabBtn) {
          const shouldTabVisible = elements.infoExpander?.closest('#tab-info');
          tabBtn.classList.toggle('tab-btn-hidden', !shouldTabVisible);
        }
      }

      Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn); // required when the page is switched from channel to watch
      return true;
    }

    /** Mirror an out-of-tab info renderer into the tab-info container. @param {Element} bodyRenderer */
    function setupInfoRendererMirror(bodyRenderer) {
      let bodyRendererNew = document.querySelector(
        'ytd-expandable-video-description-body-renderer[tyt-info-renderer]'
      );
      if (!bodyRendererNew) {
        bodyRendererNew = document.createElement('ytd-expandable-video-description-body-renderer');
        bodyRendererNew.setAttribute('tyt-info-renderer', '');
        nsTemplateObtain().appendChild(bodyRendererNew);
      }
      const cnt = insp(bodyRendererNew);
      cnt.data = Object.assign({}, insp(bodyRenderer).data);

      const inlineExpanderElm = bodyRendererNew.querySelector('ytd-text-inline-expander');
      const inlineExpanderCnt = insp(inlineExpanderElm);
      fixInlineExpanderMethods(inlineExpanderCnt);
      elements.infoExpanderRendererBack = bodyRenderer;
      elements.infoExpanderRendererFront = bodyRendererNew;
      bodyRenderer.setAttribute('tyt-info-renderer-back', '');
      bodyRendererNew.setAttribute('tyt-info-renderer-front', '');
    }

    /**
     * Resolve once the chat frame laid out (or after a bounded wait).
     * @param {HTMLIFrameElement} chatframe
     * @param {boolean} isBlankPage
     * @returns {Promise<void>}
     */
    function waitForChatFrameLayout(chatframe, isBlankPage) {
      return new Promise((/** @type {() => void} */ resolve) => {
        /** @type {IntersectionObserver | null} */ let ioObserver = null;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ioObserver) {
            ioObserver.disconnect();
            ioObserver = null;
          }
          resolve();
        };
        const timer = setTimeout(finish, 706);
        ioObserver = _registerObserver(
          new IntersectionObserver((entries, observer) => {
            for (const entry of entries) {
              const rect = entry.boundingClientRect || 0;
              if (isBlankPage || (rect.width > 0 && rect.height > 0)) {
                observer.disconnect();
                ioObserver = null;
                finish();
                break;
              }
            }
          }),
          null,
          { scope: 'session' }
        );
        ioObserver.observe(chatframe);
      });
    }

    /**
     * Move a connected element under its tab container unless it is already there.
     * @param {Element | null} node
     * @param {string} targetSelector
     * @param {string} alreadyInside
     */
    function routeInto(node, targetSelector, alreadyInside) {
      if (!(node?.isConnected && !node.closest(alreadyInside))) return;
      document.querySelector(targetSelector)?.assignChildren111(null, node, null);
    }

    /** Route the live-chat container back into the right-rail wrapper. */
    function routeLiveChatToRail() {
      const chatContainer = document.querySelector(
        '#columns.style-scope.ytd-watch-flexy [tyt-chat-container]'
      );
      if (!(chatContainer && !chatContainer.closest('secondary-wrapper'))) return;
      const secondaryWrapper = document.querySelector(
        '#secondary-inner.style-scope.ytd-watch-flexy > secondary-wrapper'
      );
      if (!secondaryWrapper) return;
      inPageRearrange = true;
      const rightTabs = secondaryWrapper.querySelector('#right-tabs');
      if (rightTabs) {
        secondaryWrapper.insertBefore(chatContainer, rightTabs.nextSibling);
      } else {
        secondaryWrapper.appendChild(chatContainer);
      }
      inPageRearrange = false;
    }

    /** Reset the one-shot insert promises after the tabview DOM was torn down. */
    function resetAfterTabsLost() {
      // watch → channel → refresh → back to watch: the insertion chain must be
      // able to fire again for this watch page.
      resetTabviewInsertPromises();
      // If the related-element animation already fired and elements.related is
      // populated, unblock the videos promise immediately.
      if (elements.related) videosElementProvidedPromise.resolve();
    }

    /** Re-bind the flexy observer and refresh the rails for a new watch element. */
    function rebindFlexyObservers() {
      // Reset stale tab state from the prior watch page.
      tabAStatus = 0;
      lastTab = '';
      lastPanel = '';
      // YouTube may replace ytd-watch-flexy across SPA navigations, so re-bind
      // the attribute observer to the new element.
      const ytdFlexyElmRefresh = elements.flexy;
      if (ytdFlexyElmRefresh) {
        aoFlexySubId = observeTarget({ id: aoFlexySubId }, ytdFlexyElmRefresh, eventMap.aoFlexyFn, {
          attributes: true,
          childList: false,
          subtree: false,
        });
      }
      Promise.resolve(lockSet.refreshSecondaryInnerLock)
        .then(eventMap.refreshSecondaryInner)
        .catch(_ll.warn);
      Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
        .then(removeKeepCommentsScroller)
        .catch(_ll.warn);
    }

    /** First watch page after boot: resolve the gates and switch plugins on. */
    function activatePluginsOnFirstWatch() {
      navigateFinishedPromise.resolve();
      if (plugin.minibrowser.toUse) plugin.minibrowser.activate();
      if (plugin.autoExpandInfoDesc.toUse) plugin.autoExpandInfoDesc.activate();
      if (plugin.fullChannelNameOnHover.toUse) plugin.fullChannelNameOnHover.activate();
    }

    /** Common post-navigation flexy touch-ups. */
    function applyFlexyAfterNavigate() {
      const chat = elements.chat;
      if (chat instanceof Element) {
        chat.setAttribute111('tyt-active-chat-frame', 'CF'); // chat and flexy ready
      }
      if (elements.infoExpander?.closest('#right-tabs')) {
        Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
      }
      Promise.resolve(lockSet.layoutFixLock).then(layoutFix).catch(_ll.warn);
      if (plugin.fullChannelNameOnHover.activated) plugin.fullChannelNameOnHover.onNavigateFinish();
    }

    /**
     * Wait for the chat frame document to be readable, tolerating a Brave delay.
     * @param {HTMLIFrameElement} chatframe
     * @returns {Promise<void>}
     */
    async function waitForChatFrameReady(chatframe) {
      if (chatframe.contentDocument === null) {
        await Promise.resolve('#').catch(_ll.warn);
      }
      await new Promise((/** @type {() => void} */ resolve) => setTimeout(resolve, 1)).catch(
        _ll.warn
      ); // neccessary for Brave
    }

    /**
     * Build and insert the #right-tabs markup and its secondary-wrapper.
     * @returns {Element | null} the inserted #right-tabs element, or null
     */
    function insertRightTabsMarkup() {
      const related = elements.related;
      setLangForPage();
      // HTML insertion hardening: parse the tab markup through a detached
      // <template> element rather than into the live DOM. The template's innerHTML
      // assignment goes through the createHTML() wrapper (safe-dom's
      // createTrustedHTML); the parsed result lives in `docTmp.content` and is read
      // as a fragment, so the markup is never rendered un-trusted.
      /** @type {DocumentFragment | HTMLElement | null} */ let docTmp = window.YouTubeSafeDOM
        ? window.YouTubeSafeDOM.createFragment(getTabsHTML())
        : null;
      if (!docTmp) {
        // fallback if safeDOM is missing
        docTmp = document.createElement('div');
        /** @type {Record<string, unknown>} */ (/** @type {object} */ (docTmp))['inner' + 'HTML'] =
          createHTML(getTabsHTML());
      }
      const newElm = docTmp.firstElementChild;
      if (newElm !== null) {
        inPageRearrange = true;
        related.parentNode.insertBefore000(newElm, related);
        inPageRearrange = false;
      }
      const rightTabs = newElm;
      if (rightTabs) {
        const commentsTabBtn = rightTabs.querySelector('[tyt-tab-content="#tab-comments"]');
        if (commentsTabBtn) {
          commentsTabBtn.classList.add('tab-btn-hidden');
        }
      }

      const secondaryWrapper = document.createElement('secondary-wrapper');
      secondaryWrapper.classList.add('tabview-secondary-wrapper');
      secondaryWrapper.id = 'secondary-inner-wrapper';
      const secondaryInner = document.querySelector('#secondary-inner.style-scope.ytd-watch-flexy');

      if (secondaryInner) {
        inPageRearrange = true;
        secondaryWrapper.replaceChildren000(...secondaryInner.childNodes);
        secondaryInner.insertBefore000(secondaryWrapper, secondaryInner.firstChild);
        inPageRearrange = false;
      }

      if (rightTabs) {
        const tabs = rightTabs.querySelector('#material-tabs');
        if (tabs) {
          _cm?.unregisterListener?.(tabsBtnClickKey);
          tabsBtnClickKey = _registerListener(tabs, 'click', eventMap['tabs-btn-click'], true);
        }
      }

      inPageRearrange = true;
      if (!rightTabs?.closest('secondary-wrapper'))
        secondaryWrapper.appendChild000(/** @type {Node} */ (rightTabs));
      inPageRearrange = false;

      return rightTabs;
    }

    /** @type {IntersectionObserver | null} */
    let ioTabBtns = null;

    /** Drop the tab-button observer from the DOM and the cleanup manager, so a
     *  disable (or re-wire) leaves no live session observer behind. */
    function releaseIoTabBtns() {
      if (!ioTabBtns) return;
      ioTabBtns.disconnect();
      _cm?.unregisterObserver?.(ioTabBtns);
      ioTabBtns = null;
    }

    /** Observe the tab buttons and route the rails once #right-tabs exists. @param {Element} rightTabs */
    function wireRightTabs(rightTabs) {
      isRightTabsInserted = true;
      releaseIoTabBtns();
      ioTabBtns = _registerObserver(
        new IntersectionObserver(
          entries => {
            for (const entry of entries) {
              const rect = entry.boundingClientRect;
              entry.target.classList.toggle('tab-btn-visible', !!(rect.width && rect.height));
            }
          },
          { rootMargin: '0px' }
        ),
        null,
        { scope: 'session' }
      );
      for (const btn of document.querySelectorAll('.tab-btn[tyt-tab-content]')) {
        ioTabBtns.observe(btn);
      }
      const related = elements.related;
      if (!related.closest('#right-tabs')) {
        document.querySelector('#tab-videos')?.assignChildren111(null, related, null);
      }
      const infoExpander = elements.infoExpander;
      if (infoExpander && !infoExpander.closest('#right-tabs')) {
        document.querySelector('#tab-info')?.assignChildren111(null, infoExpander, null);
      }
      const commentsArea = elements.comments;
      if (commentsArea && !commentsArea.closest('#right-tabs')) {
        document.querySelector('#tab-comments')?.assignChildren111(null, commentsArea, null);
      }
      if (commentsArea) {
        const btn = rightTabs.querySelector('[tyt-tab-content="#tab-comments"]');
        if (btn) {
          const shouldTabVisible =
            commentsArea.closest('#tab-comments') && !commentsArea.closest('[hidden]');
          btn.classList.toggle('tab-btn-hidden', !shouldTabVisible);
        }
      }
      rightTabsProvidedPromise.resolve();
      roRightTabs.disconnect();
      roRightTabs.observe(rightTabs);
      const ytdFlexyElm = elements.flexy;
      aoFlexySubId = observeTarget({ id: aoFlexySubId }, ytdFlexyElm, eventMap.aoFlexyFn, {
        attributes: true,
        childList: false,
        subtree: false,
      });
      Promise.resolve(lockSet.fixInitialTabStateLock)
        .then(eventMap.fixInitialTabStateFn)
        .catch(_ll.warn);

      ytdFlexyElm.incAttribute111('attr-7qlsy'); // tabsStatusCorrectionLock and video-id
    }

    /** Restore the initial tab selection after the first watch-page settle. */
    function restoreInitialTab() {
      const kTab = document.querySelector('[tyt-tab]');
      const qTab =
        !kTab || kTab.getAttribute('tyt-tab') === ''
          ? checkElementExist('ytd-watch-flexy[is-two-columns_]', '[hidden]')
          : null;
      if (checkElementExist('ytd-playlist-panel-renderer#playlist', '[hidden], [collapsed]')) {
        switchToTab(null);
        return;
      }
      if (checkElementExist('ytd-live-chat-frame#chat', '[hidden], [collapsed]')) {
        switchToTab(null);
        if (checkElementExist('ytd-watch-flexy[theater]', '[hidden]')) {
          ytBtnCollapseChat();
        }
        return;
      }
      if (!qTab) return;
      if (qTab.hasAttribute('theater')) {
        switchToTab(null);
        return;
      }
      const btn0 = document.querySelector('.tab-btn-visible'); // or default button
      switchToTab(btn0 || null);
    }

    /**
     * Wrap a Polymer element's attached/detached to fan out to the event map.
     * @param {YtProto} cProto
     * @param {string} name event-map prefix
     * @param {boolean} [forceDataChanged] also dispatch dataChanged when attached runs
     */
    function patchLifecycleHooks(cProto, name, forceDataChanged = false) {
      if (!cProto.attached498 && typeof cProto.attached === 'function') {
        cProto.attached498 = cProto.attached;
        cProto.attached = function () {
          if (!inPageRearrange) {
            Promise.resolve(this.hostElement).then(eventMap[`${name}::attached`]).catch(_ll.warn);
          }
          if (forceDataChanged) {
            Promise.resolve(this.hostElement)
              .then(eventMap[`${name}::dataChanged`])
              .catch(_ll.warn); // force dataChanged on attached
          }
          return this.attached498();
        };
      }
      if (!cProto.detached498 && typeof cProto.detached === 'function') {
        cProto.detached498 = cProto.detached;
        cProto.detached = function () {
          if (!inPageRearrange) {
            Promise.resolve(this.hostElement).then(eventMap[`${name}::detached`]).catch(_ll.warn);
          }
          return this.detached498();
        };
      }
    }

    // === EVENT MAP: custom element lifecycle & SPA navigation handlers ===
    /** @type {Record<string, any>} */
    const eventMap = {
      ceHack: () => {
        mLoaded.flag |= 2;
        document.documentElement?.setAttribute111?.('tabview-loaded', mLoaded.makeString());

        retrieveCE('ytd-watch-flexy').then(eventMap['ytd-watch-flexy::defined']).catch(_ll.warn);
        retrieveCE('ytd-expander').then(eventMap['ytd-expander::defined']).catch(_ll.warn);
        retrieveCE('ytd-watch-next-secondary-results-renderer')
          .then(eventMap['ytd-watch-next-secondary-results-renderer::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-comments-header-renderer')
          .then(eventMap['ytd-comments-header-renderer::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-live-chat-frame')
          .then(eventMap['ytd-live-chat-frame::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-comments').then(eventMap['ytd-comments::defined']).catch(_ll.warn);
        retrieveCE('ytd-engagement-panel-section-list-renderer')
          .then(eventMap['ytd-engagement-panel-section-list-renderer::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-watch-metadata')
          .then(eventMap['ytd-watch-metadata::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-playlist-panel-renderer')
          .then(eventMap['ytd-playlist-panel-renderer::defined'])
          .catch(_ll.warn);
        retrieveCE('ytd-expandable-video-description-body-renderer')
          .then(eventMap['ytd-expandable-video-description-body-renderer::defined'])
          .catch(_ll.warn);
      },

      /**
       * @param {boolean} isResize
       */
      fixForTabDisplay: isResize => {
        // isResize is true if the layout is resized (not due to tab switching)
        // youtube components shall handle the resize issue. can skip some checkings.

        bFixForResizedTabLater = false;
        for (const element of document.querySelectorAll('[io-intersected]')) {
          callWidgetMethod(element, 'calculateCanCollapse', true, 'calculateCanCollapse failed');
        }

        if (!isResize && lastTab === '#tab-info') {
          // #tab-info is now shown.
          // to fix the sizing issue (description info cards in tab info)
          for (const element of document.querySelectorAll(
            '#tab-info ytd-video-description-infocards-section-renderer, #tab-info yt-chip-cloud-renderer, #tab-info ytd-horizontal-card-list-renderer, #tab-info yt-horizontal-list-renderer'
          )) {
            callWidgetMethod(element, 'notifyResize', undefined, 'notifyResize failed');
          }
          // to fix expand/collapse sizing issue (inline-expander in tab info)
          // for example, expand button is required but not shown as it was rendered in the hidden state
          for (const element of document.querySelectorAll('#tab-info ytd-text-inline-expander')) {
            const cnt = callWidgetMethod(element, 'resize', false);
            fixInlineExpanderDisplay(cnt); // just in case
          }
        }

        if (!isResize && typeof lastTab === 'string' && lastTab.startsWith('#tab-')) {
          const tabContent = document.querySelector('.tab-content-cld:not(.tab-content-hidden)');
          if (tabContent) {
            const renderers = tabContent.querySelectorAll('yt-chip-cloud-renderer');
            for (const renderer of renderers) {
              callWidgetMethod(renderer, 'notifyResize', undefined, 'notifyResize failed');
            }
          }
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-watch-flexy::defined': cProto => {
        if (
          !cProto.updateChatLocation498 &&
          typeof cProto.updateChatLocation === 'function' &&
          cProto.updateChatLocation.length === 0
        ) {
          cProto.updateChatLocation498 = cProto.updateChatLocation;
          cProto.updateChatLocation = updateChatLocation498;
        }

        for (const [name, arity] of SECONDARY_INNER_METHODS) {
          const key = `${name}498`;
          if (
            !cProto[key] &&
            typeof cProto[name] === 'function' &&
            cProto[name].length === (arity || 0)
          ) {
            cProto[key] = cProto[name];
            cProto[name] = /** @param {...unknown} args */ function (...args) {
              return secondaryInnerFn(() =>
                typeof this[key] === 'function' ? this[key](...args) : undefined
              );
            };
          }
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-watch-next-secondary-results-renderer::defined': cProto => {
        patchLifecycle(cProto, 'ytd-watch-next-secondary-results-renderer', 'attached');
        patchLifecycle(cProto, 'ytd-watch-next-secondary-results-renderer', 'detached');

        makeInitAttached('ytd-watch-next-secondary-results-renderer');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-watch-next-secondary-results-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;
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
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-watch-next-secondary-results-renderer::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;
        if (hostElement.hasAttribute000('tyt-videos-list')) {
          elements.related = null;
          hostElement.removeAttribute000('tyt-videos-list');
        }
        _ll.info('ytd-watch-next-secondary-results-renderer::detached', hostElement);
      },

      /**
       * @param {HTMLElement} hostElement
       */
      settingCommentsVideoId: hostElement => {
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        const cnt = insp(hostElement);
        const commentsArea = elements.comments;
        if (
          commentsArea !== hostElement ||
          hostElement.isConnected !== true ||
          cnt.isAttached !== true ||
          !cnt.data ||
          cnt.hidden !== false
        )
          return;
        const ytdFlexyElm = elements.flexy;
        const ytdFlexyCnt = ytdFlexyElm ? insp(ytdFlexyElm) : null;
        if (ytdFlexyCnt?.videoId) {
          hostElement.setAttribute111('tyt-comments-video-id', ytdFlexyCnt.videoId);
        } else {
          hostElement.removeAttribute000('tyt-comments-video-id');
        }
      },
      /**
       * @param {number} lockId
       */
      checkCommentsShouldBeHidden: lockId => {
        if (lockGet.checkCommentsShouldBeHiddenLock !== lockId) return;

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
            }
          }
        }
      },
      /**
       * @param {YtProto} cProto
       */
      'ytd-comments::defined': cProto => {
        patchLifecycle(cProto, 'ytd-comments', 'attached');
        patchLifecycle(cProto, 'ytd-comments', 'detached');

        cProto._dataChanged498 = function () {
          Promise.resolve(this.hostElement)
            .then(eventMap['ytd-comments::_dataChanged498'])
            .catch(_ll.warn);
        };

        if (typeof cProto._createPropertyObserver === 'function') {
          cProto._createPropertyObserver('data', '_dataChanged498', undefined);
        } else if (typeof cProto.dataChanged_ === 'function') {
          cProto._dataChangedBackup = cProto.dataChanged_;
          cProto.dataChanged_ = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments::_dataChanged498'])
              .catch(_ll.warn);
            return this._dataChangedBackup();
          };
        } else if (typeof cProto.dataChanged === 'function') {
          cProto._dataChangedBackup = cProto.dataChanged;
          cProto.dataChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments::_dataChanged498'])
              .catch(_ll.warn);
            return this._dataChangedBackup();
          };
        }

        makeInitAttached('ytd-comments');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments::_dataChanged498': hostElement => {
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
        } else {
          hostElement.removeAttribute000('tyt-comments-data-status');
        }
        Promise.resolve(hostElement).then(eventMap.settingCommentsVideoId).catch(_ll.warn);
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;
        if (hostElement?.id !== 'comments') return;
        elements.comments = hostElement;
        _ll.info('ytd-comments::attached');
        Promise.resolve(hostElement).then(eventMap.settingCommentsVideoId).catch(_ll.warn);

        aoCommentSubId = observeTarget({ id: aoCommentSubId }, hostElement, onAoCommentMutation, {
          attributes: true,
          childList: false,
          subtree: false,
          attributeFilter: ['hidden', 'tyt-comments-video-id', 'tyt-comments-data-status'],
        });
        hostElement.setAttribute111('tyt-comments-area', '');

        const lockId = lockSet.rightTabReadyLock02;
        await rightTabsProvidedPromise.then();
        if (lockGet.rightTabReadyLock02 !== lockId) return;

        if (elements.comments !== hostElement) return;
        if (hostElement.isConnected === false) return;

        if (hostElement && !hostElement.closest('#right-tabs')) {
          document.querySelector('#tab-comments')?.assignChildren111(null, hostElement, null);
        } else {
          const shouldTabVisible =
            elements.comments?.closest('#tab-comments') && !elements.comments.closest('[hidden]');

          const commentsTabBtn = document.querySelector('[tyt-tab-content="#tab-comments"]');
          if (commentsTabBtn) {
            commentsTabBtn.classList.toggle('tab-btn-hidden', !shouldTabVisible);
          }

          Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
            .then(removeKeepCommentsScroller)
            .catch(_ll.warn);
        }
      },
      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;

        if (hostElement.hasAttribute000('tyt-comments-area')) {
          hostElement.removeAttribute000('tyt-comments-area');

          if (aoCommentSubId && _mc?.unwatch) {
            _mc.unwatch(aoCommentSubId);
            aoCommentSubId = null;
          }
          elements.comments = null;

          const commentsTabBtn = document.querySelector('[tyt-tab-content="#tab-comments"]');
          if (commentsTabBtn) {
            commentsTabBtn.classList.add('tab-btn-hidden');
          }

          Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
            .then(removeKeepCommentsScroller)
            .catch(_ll.warn);
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-comments-header-renderer::defined': cProto => {
        patchLifecycleHooks(cProto, 'ytd-comments-header-renderer', true);

        if (!cProto.dataChanged498 && typeof cProto.dataChanged === 'function') {
          cProto.dataChanged498 = cProto.dataChanged;
          cProto.dataChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(_ll.warn);
            return this.dataChanged498();
          };
        }

        makeInitAttached('ytd-comments-header-renderer');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments-header-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;
        if (!hostElement?.classList.contains('ytd-item-section-renderer')) return;

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

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments-header-renderer::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;

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

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-comments-header-renderer::dataChanged': hostElement => {
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;

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
          ytdFlexyElm?.removeAttribute000('tyt-comment-disabled');
        }

        if (
          hostElement.hasAttribute000('tyt-comments-header-field') &&
          hostElement.isConnected === true
        ) {
          headerMutationSubId = observeTarget(
            { id: headerMutationSubId },
            /** @type {Element} */ (hostElement.parentNode),
            eventMap['ytd-comments-header-renderer::deferredCounterUpdate'],
            { childList: true, attributes: false, subtree: false }
          );
          if (!headerMutationTmpNode)
            headerMutationTmpNode = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
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
          const extractCount = (/** @type {Array<{ text: string }>} */ runs) => {
            let max = -1;
            const z = runs
              .map((/** @type {{ text: string }} */ e) => {
                const c = e.text.replace(/\D+/g, '').length;
                if (c > max) max = c;
                return /** @type {[string, number]} */ ([e.text, c]);
              })
              .filter((/** @type {[string, number]} */ a) => a[1] === max);
            return z.length >= 1 ? z[0][0] : '';
          };
          const ez =
            extractCount(data.commentsCount?.runs || []) ||
            extractCount(data.countText?.runs || []) ||
            '';
          const cmCount = document.querySelector('#tyt-cm-count');
          if (ez) {
            hostElement.setAttribute111('field-of-cm-count', '');
            cmCount && (cmCount.textContent = ez.trim());
          } else {
            hostElement.removeAttribute000('field-of-cm-count');
            cmCount && (cmCount.textContent = '');
            _ll.warn('no text for #tyt-cm-count');
          }
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-expander::defined': cProto => {
        patchLifecycle(cProto, 'ytd-expander', 'attached');
        patchLifecycle(cProto, 'ytd-expander', 'detached');
        if (!cProto.calculateCanCollapse498 && typeof cProto.calculateCanCollapse === 'function') {
          cProto.calculateCanCollapse498 = cProto.calculateCanCollapse;
          cProto.calculateCanCollapse = funcCanCollapse;
        }

        if (!cProto.childrenChanged498 && typeof cProto.childrenChanged === 'function') {
          cProto.childrenChanged498 = cProto.childrenChanged;
          cProto.childrenChanged = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-expander::childrenChanged'])
              .catch(_ll.warn);
            return this.childrenChanged498();
          };
        }

        makeInitAttached('ytd-expander');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-expander::childrenChanged': hostElement => {
        if (
          hostElement?.hasAttribute000('hidden') &&
          hostElement.hasAttribute000('tyt-main-info') &&
          hostElement.firstElementChild
        ) {
          hostElement.removeAttribute('hidden');
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-expandable-video-description-body-renderer::defined': cProto => {
        patchLifecycle(cProto, 'ytd-expandable-video-description-body-renderer', 'attached');
        patchLifecycle(cProto, 'ytd-expandable-video-description-body-renderer', 'detached');

        makeInitAttached('ytd-expandable-video-description-body-renderer');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-expandable-video-description-body-renderer::attached': async hostElement => {
        if (
          hostElement instanceof HTMLElement_ &&
          isPageDOM(hostElement, '[tyt-info-renderer]') &&
          !hostElement.matches('[tyt-main-info]')
        ) {
          if (!(await registerInfoExpanderMainInfo(hostElement))) return;
        }

        if (!isValidAttachedHost(hostElement)) return;

        if (
          !(isPageDOM(hostElement, '#tab-info [tyt-main-info]') || hostElement.closest('#tab-info'))
        ) {
          setupInfoRendererMirror(hostElement);
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-expandable-video-description-body-renderer::detached': async hostElement => {
        if (!isValidDetachedHost(hostElement)) return;

        if (hostElement.hasAttribute000('tyt-main-info')) {
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-expander::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;

        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('[tyt-comments-area] #contents ytd-expander#expander') &&
          !hostElement.matches('[hidden] ytd-expander#expander')
        ) {
          hostElement.setAttribute111('tyt-content-comment-entry', '');
          ioComment.observe(hostElement);
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-expander::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;

        if (hostElement.hasAttribute000('tyt-content-comment-entry')) {
          ioComment.unobserve(hostElement);
          hostElement.removeAttribute000('tyt-content-comment-entry');
        } else if (hostElement.hasAttribute000('tyt-main-info')) {
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-live-chat-frame::defined': cProto => {
        patchLifecycleHooks(cProto, 'ytd-live-chat-frame');

        if (
          typeof cProto.urlChanged === 'function' &&
          !cProto.urlChanged66 &&
          !cProto.urlChangedAsync12 &&
          cProto.urlChanged.length === 0
        ) {
          cProto.urlChanged66 = cProto.urlChanged;
          let ath = 0;
          cProto.urlChangedAsync12 = async function () {
            await this.__urlChangedAsyncT688__;
            const t = (ath = (ath & 1073741823) + 1);
            const chatframe = this.chatframe || (this.$ || 0).chatframe || 0;
            if (chatframe instanceof HTMLIFrameElement) {
              await waitForChatFrameReady(chatframe);
              if (t !== ath) return;
              await waitForChatFrameLayout(chatframe, !this.data || this.collapsed);
              if (t !== ath) return;
            }
            this.urlChanged66();
          };
          cProto.urlChanged = function () {
            // biome-ignore lint/complexity/noUselessThisAlias: cast needed for TS strict mode
            const _this = /** @type {YtProto} */ (this);
            const t = (_this.__urlChangedAsyncT688__ =
              (_this.__urlChangedAsyncT688__ & 1073741823) + 1);
            nextBrowserTick(() => {
              if (t !== _this.__urlChangedAsyncT688__) return;
              _this.urlChangedAsync12();
            });
          };
        }

        makeInitAttached('ytd-live-chat-frame');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-live-chat-frame::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;
        if (hostElement?.id !== 'chat') return;
        _ll.info('ytd-live-chat-frame::attached');

        const lockId = lockSet.ytdLiveAttachedLock;
        const chatElem = await getGeneralChatElement();
        if (lockGet.ytdLiveAttachedLock !== lockId) return;

        if (chatElem === hostElement) {
          elements.chat = chatElem;
          const isFlexyReady = elements.flexy instanceof Element;
          chatElem.setAttribute111('tyt-active-chat-frame', isFlexyReady ? 'CF' : 'C');

          // Mark the chat's layout container so CSS and layoutFix can route it
          // into secondary-wrapper together with the right-tabs.
          const chatContainer = chatElem.closest('#chat-container') || chatElem;
          if (chatContainer && !chatContainer.hasAttribute000('tyt-chat-container')) {
            for (const p of document.querySelectorAll('[tyt-chat-container]')) {
              p.removeAttribute000('tyt-chat-container');
            }
            chatContainer.setAttribute111('tyt-chat-container', '');
          }

          aoChatSubId = observeTarget({ id: aoChatSubId }, chatElem, onAoChatMutation, {
            attributes: true,
            childList: false,
            subtree: false,
          });

          Promise.resolve(lockSet.layoutFixLock).then(layoutFix).catch(_ll.warn);
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-live-chat-frame::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;
        _ll.info('ytd-live-chat-frame::detached');
        if (hostElement.hasAttribute000('tyt-active-chat-frame')) {
          if (aoChatSubId && _mc?.unwatch) {
            _mc.unwatch(aoChatSubId);
            aoChatSubId = null;
          }
          hostElement.removeAttribute000('tyt-active-chat-frame');
          elements.chat = null;

          const ytdFlexyElm = elements.flexy;
          if (ytdFlexyElm) {
            ytdFlexyElm.removeAttribute000('tyt-chat-collapsed');
            ytdFlexyElm.setAttribute111('tyt-chat', '');
          }
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-engagement-panel-section-list-renderer::defined': cProto => {
        patchLifecycle(cProto, 'ytd-engagement-panel-section-list-renderer', 'attached');
        patchLifecycle(cProto, 'ytd-engagement-panel-section-list-renderer', 'detached');
        makeInitAttached('ytd-engagement-panel-section-list-renderer');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-engagement-panel-section-list-renderer::bindTarget': hostElement => {
        if (
          hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer[target-id][visibility]'
          )
        ) {
          hostElement.setAttribute111('tyt-egm-panel', '');
          Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
          aoEgmPanelsSubId = observeTarget(
            { id: aoEgmPanelsSubId },
            hostElement,
            onAoEgmPanelsMutation,
            {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['visibility', 'hidden'],
            }
          );
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-engagement-panel-section-list-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;

        if (
          !hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer'
          )
        )
          return;

        if (
          hostElement.getAttribute('target-id') === null &&
          hostElement.hasAttribute('visibility') &&
          hostElement.matches(
            '#panels.ytd-watch-flexy > ytd-engagement-panel-section-list-renderer[visibility*="ENGAGEMENT_PANEL_VISIBILITY_"]'
          )
        ) {
          // add an id for modern transcript panel (engagement-panel-timeline-view-consolidated)
          let tid = '';
          try {
            tid = crypto.randomUUID();
          } catch (_e) {
            logS(_e);
            tid = `${Date.now().toString(36)}-${Math.random().toString(36).substring(2)}`;
          }
          hostElement.setAttribute000('target-id', `tid051-${tid}`);
        }

        if (hostElement.hasAttribute000('target-id') && hostElement.hasAttribute000('visibility')) {
          Promise.resolve(hostElement)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(_ll.warn);
        } else {
          hostElement.setAttribute000('tyt-egm-panel-jclmd', '');
          moEgmPanelReadySubId = observeTarget(
            { id: moEgmPanelReadySubId },
            hostElement,
            onMoEgmPanelReadyMutation,
            {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['visibility', 'target-id'],
            }
          );
        }
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-engagement-panel-section-list-renderer::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;
        if (hostElement.hasAttribute000('tyt-egm-panel')) {
          hostElement.removeAttribute000('tyt-egm-panel');
          Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
        } else if (hostElement.hasAttribute000('tyt-egm-panel-jclmd')) {
          hostElement.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
        }
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-watch-metadata::defined': cProto => {
        patchLifecycle(cProto, 'ytd-watch-metadata', 'attached');
        patchLifecycle(cProto, 'ytd-watch-metadata', 'detached');

        makeInitAttached('ytd-watch-metadata');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-watch-metadata::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;

        if (plugin.fullChannelNameOnHover.activated)
          plugin.fullChannelNameOnHover.onNavigateFinish();
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-watch-metadata::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;
      },

      /**
       * @param {YtProto} cProto
       */
      'ytd-playlist-panel-renderer::defined': cProto => {
        patchLifecycle(cProto, 'ytd-playlist-panel-renderer', 'attached');
        patchLifecycle(cProto, 'ytd-playlist-panel-renderer', 'detached');

        makeInitAttached('ytd-playlist-panel-renderer');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-playlist-panel-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (!isValidAttachedHost(hostElement)) return;

        elements.playlist = hostElement;

        aoPlayListSubId = observeTarget(
          { id: aoPlayListSubId },
          hostElement,
          onAoPlayListMutation,
          {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['hidden', 'collapsed', 'attr-1y6nu'],
          }
        );
        hostElement.incAttribute111('attr-1y6nu');
      },

      /**
       * @param {HTMLElement} hostElement
       */
      'ytd-playlist-panel-renderer::detached': hostElement => {
        if (!isValidDetachedHost(hostElement)) return;
      },

      _yt_playerProvided: () => {
        mLoaded.flag |= 4;
        document.documentElement?.setAttribute111?.('tabview-loaded', mLoaded.makeString());
      },
      /**
       * @param {Element} target
       */
      relatedElementProvided: target => {
        if (target.closest('[hidden]')) return;
        elements.related = target;
        _ll.info('relatedElementProvided');
        videosElementProvidedPromise.resolve();
      },
      onceInfoExpanderElementProvidedPromised: () => {
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        _ll.info('hide-default-text-inline-expander');
        const ytdFlexyElm = elements.flexy;
        if (ytdFlexyElm) {
          ytdFlexyElm.setAttribute111('hide-default-text-inline-expander', '');
        }
      },

      /**
       * @param {number} lockId
       */
      refreshSecondaryInner: lockId => {
        if (lockGet.refreshSecondaryInnerLock !== lockId) return;

        if (!document.documentElement.hasAttribute('tabview-loaded')) return;

        const ytdFlexyElm = elements.flexy;
        if (
          ytdFlexyElm?.matches(
            'ytd-watch-flexy[theater][full-bleed-player]:not([full-bleed-no-max-width-columns])'
          )
        ) {
          ytdFlexyElm.setAttribute111('full-bleed-no-max-width-columns', '');
        }

        routeInto(elements.related, '#tab-videos', '#right-tabs #tab-videos');
        routeInto(elements.infoExpander, '#tab-info', '#right-tabs #tab-info');
        routeInto(elements.comments, '#tab-comments', '#right-tabs #tab-comments');

        // Make sure the live chat container is routed back into the right-rail
        // wrapper so it doesn't end up duplicated in the primary column.
        routeLiveChatToRail();
      },

      /**
       * @param {unknown} _evt
       */
      'yt-navigate-finish': _evt => {
        const ytdAppElm = document.querySelector(
          'ytd-page-manager#page-manager.style-scope.ytd-app'
        );
        const ytdAppCnt = insp(ytdAppElm);
        pageType = ytdAppCnt ? (ytdAppCnt.data || 0).page : null;

        if (!document.querySelector('ytd-watch-flexy #player')) return;

        if (isRightTabsInserted && !document.querySelector('#right-tabs')) resetAfterTabsLost();

        const flexyArr = [...document.querySelectorAll('ytd-watch-flexy')].filter(
          e => !e.closest('[hidden]') && e.querySelector('#player')
        );
        if (flexyArr.length !== 1) return;

        elements.flexy = flexyArr[0];
        if (isRightTabsInserted) rebindFlexyObservers();
        else activatePluginsOnFirstWatch();

        applyFlexyAfterNavigate();
      },

      onceInsertRightTabs: () => {
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        let rightTabs = document.querySelector('#right-tabs');
        if (!rightTabs && elements.related) rightTabs = insertRightTabsMarkup();
        if (rightTabs) wireRightTabs(rightTabs);
      },

      aoFlexyFn: () => {
        Promise.resolve(lockSet.checkCommentsShouldBeHiddenLock)
          .then(eventMap.checkCommentsShouldBeHidden)
          .catch(_ll.warn);

        Promise.resolve(lockSet.refreshSecondaryInnerLock)
          .then(eventMap.refreshSecondaryInner)
          .catch(_ll.warn);

        Promise.resolve(lockSet.tabsStatusCorrectionLock)
          .then(eventMap.tabsStatusCorrection)
          .catch(_ll.warn);

        const videoId = getCurrentVideoId();
        if (videoId !== tmpLastVideoId) {
          tmpLastVideoId = videoId;
          Promise.resolve(lockSet.updateOnVideoIdChangedLock)
            .then(eventMap.updateOnVideoIdChanged)
            .catch(_ll.warn);
        }
      },

      /**
       * @param {number} lockId
       */
      twoColumnChanged10: lockId => {
        if (lockId !== lockGet.twoColumnChanged10Lock) return;
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
              behavior.invalidate(false);
            }
          }
        }
      },

      // === tabsStatusCorrection: diff/reconcile tabview bitmask state ===

      // --- Orchestrator: calls helpers in sequence ---
      /**
       * @param {number} lockId
       */
      tabsStatusCorrection: lockId => {
        if (lockId !== lockGet.tabsStatusCorrectionLock) return;
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        const ytdFlexyElm = elements.flexy;
        if (!ytdFlexyElm) return;
        const p = tabAStatus;
        const q = calculationFn(p, FLAG.ALL);
        if (p === q) return;
        _ll.info(388, p, q);

        const special = resolveYtlstmSpecial(p, q);
        const { resetForPanelDisappeared } = updateLastPanel(p, q, special);
        tabAStatus = q;

        if (dispatchSpecialAction(special, ytdFlexyElm)) return;

        let { actioned, bFixForResizedTab } = handleTabPlaylistTransitions(p, q);
        ({ actioned } = handleFullscreenTransitions(p, q, actioned));
        ({ actioned } = handleAutoFix(p, q, actioned, resetForPanelDisappeared));

        if (bFixForResizedTab) {
          bFixForResizedTabLater = false;
          Promise.resolve(0).then(eventMap.fixForTabDisplay).catch(_ll.warn);
        }

        if (
          ((p & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS) !==
          ((q & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS)
        ) {
          Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
          Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
            .then(removeKeepCommentsScroller)
            .catch(_ll.warn);
          Promise.resolve(lockSet.layoutFixLock).then(layoutFix).catch(_ll.warn);
        }
      },

      /**
       * @param {number} lockId
       */
      updateOnVideoIdChanged: lockId => {
        if (lockId !== lockGet.updateOnVideoIdChangedLock) return;
        const videoId = tmpLastVideoId;
        if (!videoId) return;

        const bodyRenderer = elements.infoExpanderRendererBack;
        const bodyRendererNew = elements.infoExpanderRendererFront;

        if (bodyRendererNew && bodyRenderer) {
          insp(bodyRendererNew).data = insp(bodyRenderer).data;
        }

        Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
      },

      /**
       * @param {number} lockId
       */
      fixInitialTabStateFn: async lockId => {
        if (lockGet.fixInitialTabStateLock !== lockId) return;

        const delayTime = fixInitialTabStateK > 0 ? 200 : 1;
        await delayPn(delayTime);
        if (lockGet.fixInitialTabStateLock !== lockId) return;

        restoreInitialTab();
        fixInitialTabStateK++;
      },

      /**
       * @param {Event} evt
       */
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

    scheduleInsertChains();

    const isCustomElementsProvided =
      typeof customElements !== 'undefined' &&
      typeof (customElements || 0).whenDefined === 'function';

    const promiseForCustomYtElementsReady = isCustomElementsProvided
      ? Promise.resolve(0)
      : new Promise((/** @type {() => void} */ callback) => {
          const EVENT_KEY_ON_REGISTRY_READY = 'ytI-ce-registry-created';
          if (typeof customElements === 'undefined') {
            if (!('__CE_registry' in document)) {
              // https://github.com/webcomponents/polyfills/
              Object.defineProperty(document, '__CE_registry', {
                get() {},
                set(nv) {
                  if (typeof nv === 'object') {
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
            /**
             * @param {unknown} _evt
             */
            let eventHandler = _evt => {
              document.removeEventListener(EVENT_KEY_ON_REGISTRY_READY, eventHandler, false);
              const f = callback;
              callback = () => {};
              eventHandler = () => {};
              f();
            };
            _registerListener(document, EVENT_KEY_ON_REGISTRY_READY, eventHandler, false, true);
          } else {
            callback();
          }
        });

    /**
     * @param {string} nodeName
     */
    const retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
        const dummy = document.querySelector(nodeName) || document.createElement(nodeName);
        const cProto = insp(dummy).constructor.prototype;
        return cProto;
      } catch (e) {
        logS(e);
        _ll.warn(e);
      }
    };

    const moOverallRes = {
      _yt_playerProvided: () => (window || 0)._yt_player || 0 || 0,
    };

    /** @type {{ resolve: () => void } | null} */ let promiseWaitNext = null;
    const onMoOverallMutation = () => {
      if (promiseWaitNext) {
        promiseWaitNext.resolve();
        promiseWaitNext = null;
      }

      if (typeof moOverallRes._yt_playerProvided === 'function') {
        const r = moOverallRes._yt_playerProvided();
        if (r) {
          /** @type {YtProto} */ (moOverallRes)._yt_playerProvided = r;
          eventMap._yt_playerProvided();
        }
      }
    };

    // Route the document-wide subtree / childList watcher through the shared
    // mutation coordinator; its root observer already has subtree+childList.
    const setupMoOverallSubscription = () => {
      if (_mc?.subscribeRoot) {
        _mc.subscribeRoot('main::moOverall', onMoOverallMutation, {
          childList: true,
          attributes: false,
          subtree: true,
        });
        return;
      }
      const moOverall = _registerObserver(new MutationObserver(onMoOverallMutation), null, {
        scope: 'session',
      });
      moOverall.observe(document, { subtree: true, childList: true });
    };
    setupMoOverallSubscription();

    /**
     * @param {MutationRecord[]} mutations
     */
    const onMoEgmPanelReadyMutation = mutations => {
      for (const mutation of mutations) {
        const target = /** @type {Element} */ (mutation.target);
        if (!target.hasAttribute000('tyt-egm-panel-jclmd')) continue;
        if (target.hasAttribute000('target-id') && target.hasAttribute000('visibility')) {
          target.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
          Promise.resolve(target)
            .then(eventMap['ytd-engagement-panel-section-list-renderer::bindTarget'])
            .catch(_ll.warn);
        }
      }
    };

    const moEgmPanelReadyClearFn = () => {
      if (document.querySelector('[tyt-egm-panel-jclmd]') === null) {
        if (moEgmPanelReadySubId && _mc?.unwatch) {
          _mc.unwatch(moEgmPanelReadySubId);
          moEgmPanelReadySubId = null;
        }
      }
    };

    // Document-level listeners for tabview boot and custom-element
    // lifecycle detection must survive global cleanupManager.cleanup()
    // on yt-navigate-start. If they are registered through cleanupManager,
    // the first navigation would disconnect them and tabview would never
    // re-initialize on subsequent watch pages (e.g. refresh → navigate
    // to watch, or watch → channel → refresh → back). Use native
    // addEventListener so these listeners persist for the page session.
    _registerListener(document, 'yt-navigate-finish', eventMap['yt-navigate-finish'], false, true);
    /** @param {Event} evt */
    const onAnimationStart = evt => {
      const f = eventMap[/** @type {AnimationEvent} */ (evt).animationName];
      if (typeof f === 'function') f(evt.target);
    };
    _registerListener(document, 'animationstart', onAnimationStart, capturePassive, true);

    if (tabviewEnabled) {
      mLoaded.flag |= 1;
      document.documentElement?.setAttribute111?.('tabview-loaded', mLoaded.makeString());
    }

    // Late injection: this core booted onto an already-settled watch page (the
    // feature was enabled mid-session, or the first watch page was reached from
    // a non-watch page such as the channel that hosts Play All). The
    // yt-navigate-finish listener above never saw that navigation, so replay the
    // settle work (flexy reference + first-watch gates) once; otherwise the
    // insert chain waits for the next navigation and the right-tabs rail never
    // appears.
    if (tabviewEnabled && document.querySelector('ytd-watch-flexy #player')) {
      eventMap['yt-navigate-finish']();
    }

    promiseForCustomYtElementsReady.then(eventMap.ceHack).catch(_ll.warn);

    // Keep Tabview labels and CSS-generated loading text in sync with the
    // i18n service. English fallbacks keep the rail usable while a
    // remote locale is still loading.
    function applyI18n() {
      const i18n = window.YouTubePlusI18n;
      /** @type {Record<string, string>} */ const FALLBACK = {
        info: 'Info',
        comments: 'Comments',
        videos: 'Videos',
        playlist: 'Playlist',
      };
      /**
       * Quote a string for use by CSS `content: var(...)`.
       * @param {string} value
       * @returns {string}
       */
      const asCSSContentString = value =>
        `"${String(value)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/[\r\n\f]/g, ' ')}"`;
      /**
       * @param {HTMLElement} btn
       * @param {string} key
       */
      const setTabButtonLabel = (btn, key) => {
        let span = null;
        for (const s of btn.querySelectorAll('span')) {
          if (s.id !== 'tyt-cm-count') {
            span = s;
            break;
          }
        }
        const i18nService = window.YouTubePlusI18n || i18n;
        const text = i18nService?.t?.(key);
        const label = text && text !== key ? text : FALLBACK[key] || key;
        if (span) {
          span.textContent = label;
        }
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
      };
      const updateTabLabels = () => {
        for (const { id, key } of [
          { id: 'tab-btn1', key: 'info' },
          { id: 'tab-btn3', key: 'comments' },
          { id: 'tab-btn4', key: 'videos' },
          { id: 'tab-btn5', key: 'playlist' },
        ]) {
          const btn = document.getElementById(id);
          if (btn) setTabButtonLabel(btn, key);
        }
      };
      const updateCSSVars = () => {
        const i18nService = window.YouTubePlusI18n || i18n;
        if (!i18nService) return;
        const loading = i18nService.t('loading');
        if (loading && loading !== 'loading')
          document.documentElement.style.setProperty(
            '--tabview-text-loading',
            asCSSContentString(loading)
          );
        const fetching = i18nService.t('fetching');
        if (fetching && fetching !== 'fetching')
          document.documentElement.style.setProperty(
            '--tabview-text-fetching',
            asCSSContentString(fetching)
          );
      };
      const run = () => {
        updateCSSVars();
        updateTabLabels();
      };
      if (i18n && typeof i18n.onLanguageChange === 'function') {
        i18n.onLanguageChange(run);
      }
      _registerListener(window, 'youtube-plus-i18n-ready', run, undefined, true);
      _registerListener(window, 'youtube-plus-language-changed', run, undefined, true);
      rightTabsProvidedPromise.then(run);
    }
    applyI18n();

    /** Run `fn` with the inPageRearrange flag set. @param {() => void} fn */
    function withInPageRearrange(fn) {
      inPageRearrange = true;
      fn();
      inPageRearrange = false;
    }

    /** @param {Element} secondaryInner */
    function unwrapSecondaryInnerWrapper(secondaryInner) {
      const wrapper = secondaryInner.querySelector('#secondary-inner-wrapper');
      if (!wrapper) return;
      withInPageRearrange(() => {
        while (wrapper.firstChild) {
          secondaryInner.insertBefore(wrapper.firstChild, wrapper);
        }
        wrapper.remove();
      });
    }

    /** @param {Element} primaryInner @param {Element} infoExpander */
    function reinsertBeforeComments(primaryInner, infoExpander) {
      withInPageRearrange(() => {
        const commentsNode = primaryInner.querySelector('#comments');
        if (commentsNode) {
          primaryInner.insertBefore(infoExpander, commentsNode);
        } else {
          primaryInner.appendChild(infoExpander);
        }
      });
    }

    /** @param {Element} node @param {Element} secondaryInner @param {Element|null} related */
    function reinsertChat(node, secondaryInner, related) {
      withInPageRearrange(() => {
        // Insert chat before related so the native order is preserved.
        if (related && related.parentNode === secondaryInner) {
          secondaryInner.insertBefore(node, related);
        } else {
          secondaryInner.appendChild(node);
        }
      });
    }

    /** @param {Element} ytdFlexy */
    function clearFlexyTabviewAttributes(ytdFlexy) {
      for (const attr of [
        'hide-default-text-inline-expander',
        'tyt-tab',
        'tyt-chat',
        'tyt-chat-collapsed',
        'tyt-egm-panel_',
        'tyt-comment-disabled',
        'tyt-playlist-expanded',
        'keep-comments-scroller',
        'full-bleed-no-max-width-columns',
        'tyt-external-ytlstm',
      ]) {
        ytdFlexy.removeAttribute(attr);
      }
    }

    /** @returns {{ related: Element|null, comments: Element|null, infoExpander: Element|null, chat: Element|null, primaryInner: Element|null, secondaryInner: Element|null }} */
    function resolveLayoutNodes() {
      return {
        related: elements.related || document.querySelector('#related.ytd-watch-flexy'),
        comments: elements.comments || document.querySelector('ytd-comments#comments'),
        infoExpander:
          elements.infoExpander ||
          document.querySelector('ytd-text-inline-expander#structured-description'),
        chat:
          elements.chat ||
          document.querySelector('ytd-live-chat-frame#chat[tyt-active-chat-frame]'),
        primaryInner: document.querySelector('#primary-inner.style-scope.ytd-watch-flexy'),
        secondaryInner: document.querySelector('#secondary-inner.style-scope.ytd-watch-flexy'),
      };
    }

    /** @param {Element} parent @param {Element} node */
    function appendInPage(parent, node) {
      withInPageRearrange(() => parent.appendChild(node));
    }

    /** @param {Element} primaryInner @param {Element} comments */
    function appendCommentsBack(primaryInner, comments) {
      withInPageRearrange(() => {
        const target =
          primaryInner.querySelector('#below.style-scope.ytd-watch-flexy') || primaryInner;
        target.appendChild(comments);
      });
    }

    /** @param {Element|null} related @param {Element|null} comments @param {Element|null} chat */
    function cleanupLayoutMarkers(related, comments, chat) {
      const markers = [
        () => related?.removeAttribute000('tyt-videos-list'),
        () => comments?.removeAttribute000('tyt-comments-area'),
        () => chat?.removeAttribute000('tyt-active-chat-frame'),
        () => chat?.closest('[tyt-chat-container]')?.removeAttribute000('tyt-chat-container'),
      ];
      for (const fn of markers) fn();
    }

    const restoreOriginalLayout = () => {
      document.documentElement?.removeAttribute?.('tabview-loaded');
      const { related, comments, infoExpander, chat, primaryInner, secondaryInner } =
        resolveLayoutNodes();

      if (secondaryInner) unwrapSecondaryInnerWrapper(secondaryInner);
      if (related && secondaryInner) appendInPage(secondaryInner, related);
      if (infoExpander && primaryInner) reinsertBeforeComments(primaryInner, infoExpander);
      if (comments && primaryInner) appendCommentsBack(primaryInner, comments);

      const targetChat = chat?.closest('[tyt-chat-container]') || chat;
      if (targetChat && secondaryInner) reinsertChat(targetChat, secondaryInner, related);

      _cm?.unregisterListener?.(tabsBtnClickKey);
      tabsBtnClickKey = null;
      document.querySelector('#right-tabs')?.remove();
      if (roRightTabs) roRightTabs.disconnect();
      releaseIoTabBtns();
      if (aoFlexySubId && _mc?.unwatch) {
        _mc.unwatch(aoFlexySubId);
        aoFlexySubId = null;
      }

      // Clean stale tyt-* attributes AFTER the observer is disconnected
      // (removing them while the observer is active triggers tabsStatusCorrection).
      const ytdFlexy = elements.flexy;
      if (ytdFlexy) clearFlexyTabviewAttributes(ytdFlexy);

      // Remove tabview-specific markers from elements we moved back to their
      // original locations so YouTube's native layout can take over cleanly.
      cleanupLayoutMarkers(related, comments, chat);

      // Reset stale tab state so re-enabling tabview starts clean.
      tabAStatus = 0;
      lastTab = '';
      lastPanel = '';
      isRightTabsInserted = false;
      // Reset the insertion promises so a later re-enable or navigation back
      // to a watch page can go through the full insertion chain again.
      resetTabviewInsertPromises();
    };

    /** Re-enable tabview in place after the setting was switched back on. */
    function reenableTabview() {
      mLoaded.flag |= 1;
      document.documentElement?.setAttribute111?.('tabview-loaded', mLoaded.makeString());
      isRightTabsInserted = false;

      // Repopulate elements from the live DOM (resetTabviewInsertPromises nulled
      // them all; CSS animations won't retrigger).
      const flexy = [...document.querySelectorAll('ytd-watch-flexy')].find(
        el => !el.closest('[hidden]') && el.querySelector('#player')
      );
      if (flexy) elements.flexy = flexy;

      const rel = document.querySelector('#related.ytd-watch-flexy');
      if (rel && !rel.closest('[hidden]')) elements.related = rel;

      const comments = document.querySelector('ytd-comments#comments');
      if (comments) elements.comments = comments;

      const expander = document.querySelector(
        'ytd-watch-flexy ytd-text-inline-expander#structured-description,' +
          'ytd-watch-flexy ytd-expandable-video-description-body-renderer[tyt-main-info]'
      );
      if (expander) elements.infoExpander = expander;

      // Resolving the gates triggers the Promise.all chains from resetTabviewInsertPromises.
      if (elements.related) videosElementProvidedPromise.resolve();
      if (elements.infoExpander) infoExpanderElementProvidedPromise.resolve();
      navigateFinishedPromise.resolve();

      // Defer yt-navigate-finish so onceInsertRightTabs completes first (microtask).
      Promise.resolve().then(() => {
        if (typeof eventMap?.['yt-navigate-finish'] === 'function') {
          eventMap['yt-navigate-finish']();
        }
      });
    }

    _registerListener(
      window,
      'youtube-plus-settings-updated',
      (/** @type {Event} */ e) => {
        const detail = /** @type {CustomEvent<{ enableTabview?: boolean }>} */ (e).detail;
        const tabviewEnabled = detail?.enableTabview !== false;
        const currentlyLoaded = document.documentElement?.hasAttribute?.('tabview-loaded');
        if (tabviewEnabled && !currentlyLoaded) {
          reenableTabview();
        } else if (!tabviewEnabled && currentlyLoaded) {
          restoreOriginalLayout();
        }
      },
      undefined,
      true
    );

    // =========================================================================
    // === SECTION: Tabview command bridge (sandbox -> page context) ===========
    // =========================================================================
    // The tabview core runs in the page context (injected via GM_addElement),
    // while feature modules run in the userscript sandbox. Until this bridge
    // existed the sandbox reached into tabview internals by hand: it clicked
    // tab buttons directly and set `keep-comments-scroller` with a plain
    // setAttribute, bypassing the lock protocol that owns that attribute. A
    // concurrent removeKeepCommentsScroller() could then strand the attribute,
    // which permanently disables the comment pre-loading CSS. This bridge is
    // now the only supported way in.
    //
    //   inbound : document event `yp-tabview-cmd::<key>`  { cmd, args }
    //   outbound: document event `yp-tabview-evt::<key>`  { evt, detail }
    //
    // The key is per page load. It is not a security boundary (the page can
    // read it) - it only prevents two injected copies from crosstalking.
    const BRIDGE_IN = `yp-tabview-cmd::${communicationKey}`;
    const BRIDGE_OUT = `yp-tabview-evt::${communicationKey}`;

    tabviewEmit = (evt, detail) => {
      document.dispatchEvent(new CustomEvent(BRIDGE_OUT, { detail: { evt, detail } }));
    };

    /**
     * Pre-load the comments tab without leaving it selected.
     *
     * Takes the `keep-comments-scroller` lock BEFORE touching the attribute,
     * so any in-flight removeKeepCommentsScroller() is invalidated by the new
     * lock id instead of racing us. Replaces the sandbox-side
     * preloadCommentsInBackground(), which did neither.
     * @returns {Promise<boolean>}
     */
    const preloadCommentsTab = async () => {
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return false;
      const commentsBtn = document.querySelector(
        '#material-tabs a[tyt-tab-content="#tab-comments"]'
      );
      const commentsTab = document.querySelector('#tab-comments');
      if (!(commentsBtn && commentsTab)) return false;
      if (commentsTab.getAttribute000('tyt-comments-preloaded') === '1') return true;

      lockSet.removeKeepCommentsScrollerLock;
      if (!ytdFlexyElm.hasAttribute000('keep-comments-scroller')) {
        ytdFlexyElm.setAttribute111('keep-comments-scroller', '');
      }

      const activeBtn = document.querySelector('#material-tabs a[tyt-tab-content].active');
      switchToTab(commentsBtn);
      await new Promise((/** @type {(v?: unknown) => void} */ resolve) => {
        const rafId = requestAnimationFrame(() => resolve(0));
        _cm?.registerAnimationFrame?.(rafId);
      });
      commentsTab.setAttribute111('tyt-comments-preloaded', '1');
      if (activeBtn && activeBtn !== commentsBtn && activeBtn.isConnected) {
        switchToTab(activeBtn);
      }
      return true;
    };

    /** @type {Record<string, (args?: unknown) => unknown>} */
    const bridgeCommands = {
      expandChat: () => {
        ytBtnExpandChat();
        // YouTube's Polymer binding does not always fire when the frame is
        // uncollapsed programmatically, leaving #chatframe with no src and an
        // empty chat panel. Repair it here so one owner handles the fix.
        const chat = /** @type {(Element & { url?: string }) | null} */ (
          document.querySelector('ytd-live-chat-frame#chat')
        );
        const iframe = /** @type {HTMLIFrameElement | null} */ (
          chat ? chat.querySelector000('iframe#chatframe') : null
        );
        if (iframe && !iframe.src && chat?.url) {
          iframe.src = chat.url;
        }
        return true;
      },
      collapseChat: () => {
        ytBtnCollapseChat();
        return true;
      },
      preloadComments: () => preloadCommentsTab(),
      releaseCommentsScroller: () =>
        Promise.resolve(lockSet.removeKeepCommentsScrollerLock).then(removeKeepCommentsScroller),
      switchTab: args => {
        const tab = String(/** @type {{ tab?: string }} */ (args)?.tab || '');
        if (!/^#tab-[a-z]+$/.test(tab)) return false;
        const link = document.querySelector(`#material-tabs a[tyt-tab-content="${tab}"]`);
        if (!link) return false;
        switchToTab(link);
        return true;
      },
    };

    _registerListener(
      document,
      BRIDGE_IN,
      (/** @type {Event} */ ev) => {
        try {
          const detail = /** @type {CustomEvent<{ cmd?: unknown; args?: unknown }>} */ (ev).detail;
          const cmd = detail ? detail.cmd : null;
          if (typeof cmd !== 'string' || !Object.hasOwn(bridgeCommands, cmd)) return;
          Promise.resolve(bridgeCommands[cmd](detail.args)).catch(_ll.warn);
        } catch (_e) {
          logS(_e);
          _ll.warn('tabview bridge command failed', _e);
        }
      },
      false,
      true
    );

    tabviewEmit('ready', {
      tabs: ['#tab-info', '#tab-comments', '#tab-videos', '#tab-list'],
    });
  } catch (e) {
    logS(e);
    _ll.error('error 0xF491', e);
  }
};
const styles = {
  get main() {
    return window.YouTubePlusDesignSystem?.getStyle?.('yp-tabview-core') || '';
  },
};
(async () => {
  const logS = (
    /** @type {unknown} */ _err2,
    /** @type {string|undefined} */ _label2 = undefined
  ) => window.YouTubeUtils?.logSuppressed?.(_err2, _label2 || 'Main');
  if (typeof window !== 'undefined' && window.__ytpMainBootDone__) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__ytpMainBootDone__ = true;
    // --- Sandbox-side tabview API -----------------------------------------
    // Feature modules must go through this surface instead of poking tabview
    // DOM internals. Reads are answered straight from the DOM (attributes are
    // shared between realms); writes are forwarded to the page context over the
    // command bridge, which applies them under the core's lock protocol.
    /** @type {Map<string, Set<(...args: unknown[]) => void>>} */
    const tabviewSubscribers = new Map();
    let tabviewBridgeAttached = false;

    const sendTabviewCmd = (/** @type {string} */ cmd, /** @type {unknown} */ args = undefined) => {
      try {
        document.dispatchEvent(
          new CustomEvent(`yp-tabview-cmd::${communicationKey}`, {
            detail: { cmd, args },
          })
        );
        return true;
      } catch (_e) {
        logS(_e);
        return false;
      }
    };

    const attachTabviewBridge = () => {
      if (tabviewBridgeAttached) return;
      tabviewBridgeAttached = true;
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        `yp-tabview-evt::${communicationKey}`,
        (/** @type {Event} */ ev) => {
          const detail = /** @type {CustomEvent<{ evt?: string; detail?: unknown }>} */ (ev).detail;
          const evt = detail?.evt;
          const set = evt ? tabviewSubscribers.get(evt) : null;
          if (!set) return;
          for (const cb of set) {
            try {
              cb(detail.detail);
            } catch (_e) {
              logS(_e);
            }
          }
        },
        undefined,
        true
      );
    };

    const onTabviewEvent = (
      /** @type {string} */ evt,
      /** @type {(detail: unknown) => void} */ cb
    ) => {
      if (typeof cb !== 'function') return () => {};
      attachTabviewBridge();
      if (!tabviewSubscribers.has(evt)) tabviewSubscribers.set(evt, new Set());
      tabviewSubscribers.get(evt)?.add(cb);
      return () => {
        tabviewSubscribers.get(evt)?.delete(cb);
      };
    };

    window.YouTubePlusMain = {
      communicationKey: () => communicationKey,
      isEnabled: () => window.YouTubeUtils?.loadFeatureEnabled?.('enableTabview') !== false,

      /** True once the tabview overlay has been mounted for this page. */
      isReady: () =>
        typeof document !== 'undefined' &&
        !!document.documentElement?.hasAttribute?.('tabview-loaded'),

      /** Currently selected tab, e.g. '#tab-comments', or null. */
      getActiveTab: () =>
        document.querySelector('ytd-watch-flexy')?.getAttribute('tyt-tab') || null,

      /** The tab ids this build ships. */
      getTabs: () => ['#tab-info', '#tab-comments', '#tab-videos', '#tab-list'],

      /** Select a tab. @param {string} tab e.g. '#tab-comments' */
      switchToTab: (/** @type {string} */ tab) => sendTabviewCmd('switchTab', { tab }),

      /**
       * Render the comments tab once so YouTube loads it, then restore the
       * prior tab. Runs under the core's keep-comments-scroller lock; callers
       * must not set that attribute themselves.
       */
      preloadComments: () => sendTabviewCmd('preloadComments'),

      /** Release the keep-comments-scroller lock taken by preloadComments(). */
      releaseCommentsScroller: () => sendTabviewCmd('releaseCommentsScroller'),

      /** Expand the live chat frame (page-context Polymer path). */
      expandLiveChat: () => sendTabviewCmd('expandChat'),

      /** Collapse the live chat frame. */
      collapseLiveChat: () => sendTabviewCmd('collapseChat'),

      /**
       * Subscribe to tab switches. Replaces observing class mutations on
       * .tab-content-cld and intercepting .tab-btn clicks.
       * @param {(detail: { tab: string | null }) => void} cb
       * @returns {() => void} unsubscribe
       */
      onTabChange: cb => onTabviewEvent('tabchange', /** @type {(detail: unknown) => void} */ (cb)),

      /**
       * Fires once the page-context core has installed its command bridge.
       * @param {(detail: { tabs: string[] }) => void} cb
       * @returns {() => void} unsubscribe
       */
      onReady: cb => onTabviewEvent('ready', /** @type {(detail: unknown) => void} */ (cb)),
    };
  }

  const _ds =
    typeof window !== 'undefined' && window.YouTubePlusDesignSystem
      ? window.YouTubePlusDesignSystem
      : null;

  const communicationKey = `ck-${Date.now()}-${Math.floor(Math.random() * 314159265359 + 314159265359).toString(36)}`;

  /** @type {PromiseConstructor} */
  const Promise = /** @type {PromiseConstructor} */ ((async () => {})().constructor); // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

  if (!document.documentElement) {
    await new Promise(
      /** @param {(value?: unknown) => void} resolve */
      resolve => {
        const check = () => {
          if (document.documentElement) {
            resolve();
            return;
          }
          setTimeout(check, 0);
        };
        check();
      }
    );
  }
  const sourceURL = 'debug://tabview-youtube/tabview.execution.js';
  const tabviewEnabledOnLoad = window.YouTubeUtils?.loadFeatureEnabled?.('enableTabview') !== false;
  const buildCoreScriptText = (/** @type {boolean} */ enabled) =>
    `(${executionScript})(${JSON.stringify(communicationKey)}, ${JSON.stringify({
      enabled,
    })});${'\n\n'}//# sourceURL=${sourceURL}${'\n'}`;

  /** @type {boolean} */
  let _tabviewCoreInjected = false;

  /**
   * Inject the page-realm core exactly once per page. Late injection is
   * safe: the core resolves custom elements through whenDefined, so it
   * picks up elements YouTube already upgraded.
   * @param {boolean} enabled activation flag passed to the core
   * @returns {void}
   */
  const injectTabviewCore = (/** @type {boolean} */ enabled) => {
    if (_tabviewCoreInjected) return;
    _tabviewCoreInjected = true;
    const _scriptParent = document.head || document.documentElement;
    const scriptText = buildCoreScriptText(enabled);
    if (typeof GM_addElement === 'function') {
      GM_addElement(_scriptParent, 'script', {
        textContent: scriptText,
      });
    } else if (_scriptParent) {
      const _s = document.createElement('script');
      if (typeof window.trustedTypes === 'undefined') {
        // No Trusted Types: a plain string is a legal script sink.
        _s.textContent = scriptText;
      } else {
        const trustedScript = window.YouTubeSafeDOM?.createTrustedScript?.(scriptText) ?? null;
        if (!trustedScript) {
          window.YouTubePlusLogger?.debug?.(
            'Main',
            'Tabview core not injected: Trusted Types policy unavailable'
          );
          return;
        }
        _s.textContent = trustedScript;
      }
      _scriptParent.appendChild(_s);
    }
  };

  /**
   * True when the tabview overlay can bind on the current page: a watch route,
   * or the watch-page root already present in the DOM. Home, search, channel
   * and every other page kind are skipped, so neither the core script nor its
   * rules are paid for there.
   * @returns {boolean}
   */
  const isTabviewPage = () => {
    const path = window.location.pathname;
    if (path === '/watch' || path.startsWith('/watch/')) return true;
    return !!document.querySelector('ytd-watch-flexy');
  };

  const addTabviewStyles = () => {
    if (_ds?.StyleManager && typeof _ds.StyleManager.add === 'function') {
      _ds.StyleManager.add('yp-tabview-core', styles.main);
    }
  };

  const removeTabviewStyles = () => {
    if (_ds?.StyleManager && typeof _ds.StyleManager.remove === 'function') {
      _ds.StyleManager.remove('yp-tabview-core');
    }
  };

  /**
   * Activate tabview for the current page. The core is session-once; the rules
   * are applied idempotently. A no-op while the feature is off or the page is
   * not a watch page.
   * @returns {void}
   */
  const ensureTabview = () => {
    if (window.YouTubeUtils?.loadFeatureEnabled?.('enableTabview') === false) return;
    if (!isTabviewPage()) return;
    addTabviewStyles();
    injectTabviewCore(true);
  };

  if (tabviewEnabledOnLoad && isTabviewPage()) {
    // The page-realm core is injected only when tabview is on and the page can
    // host the overlay, so neither a disabled feature nor a non-watch page
    // pays for the core or its rules.
    addTabviewStyles();
    injectTabviewCore(true);
  }

  // A watch page is reachable through YouTube's SPA router long after boot.
  // Activate the overlay when a navigation lands on one; leaving a watch page
  // drops the rules (the session-once core stays injected, and the next watch
  // navigation re-activates it).
  const _onTabviewNavigate = () => {
    if (isTabviewPage()) ensureTabview();
    else removeTabviewStyles();
  };

  const _onSettingsUpdated = (/** @type {Event} */ e) => {
    try {
      const ce = /** @type {CustomEvent} */ (e);
      const tabviewEnabled = ce?.detail?.enableTabview !== false;
      if (tabviewEnabled) {
        // Enabling mid-session: if the core never ran (Tabview was off at
        // boot), inject it now with activation on; the core resolves
        // already-upgraded custom elements via whenDefined. When the core
        // already ran at boot it stays session-once and only styles are
        // (re)applied. A non-watch page defers activation to its next watch
        // navigation.
        ensureTabview();
      } else {
        removeTabviewStyles();
      }
    } catch (_e) {
      logS(_e);
      // StyleManager can be unavailable or a host style may reject removal.
    }
  };
  if (window.YouTubePlusCleanupManager?.registerListener) {
    window.YouTubePlusCleanupManager.registerListener(
      window,
      'youtube-plus-settings-updated',
      _onSettingsUpdated,
      undefined,
      true
    );
    window.YouTubePlusCleanupManager.registerListener(
      document,
      'yt-navigate-finish',
      _onTabviewNavigate,
      undefined,
      true
    );
  } else {
    window.addEventListener('youtube-plus-settings-updated', _onSettingsUpdated); // lint:custom:ignore
    // Session lifetime: the SPA router keeps firing after boot, so this must
    // outlive the per-navigation cleanup sweep.
    document.addEventListener('yt-navigate-finish', _onTabviewNavigate); // lint:custom:ignore
  }
})();
