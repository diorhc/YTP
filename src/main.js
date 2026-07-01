// @ts-nocheck
// ---------------------------------------------------------------------------
// Strict-checking exemption for this file.
//
// The file is 6100+ lines of hand-written ES2020 that predates the
// strict checkJs flow. Removing @ts-nocheck produces ~628 errors.
//
// Migration plan (incremental, by category):
//   Phase 1 — Outer IIFE (lines 6056-6154): annotate with JSDoc, ~15 errors.
//   Phase 2 — Style object (lines 5891-6054): type as Record<string, string>.
//   Phase 3 — executionScript helpers (flag constants, layout state):
//             add @type annotations to ~50 most-trafficked variables.
//   Phase 4 — executionScript core (tab switching, comment patching):
//             annotate function parameters and return types.
//   Phase 5 — Remove @ts-nocheck, fix remaining errors category-by-category.
//
// Each phase should be a separate commit to keep reviews manageable.
// ---------------------------------------------------------------------------

/**
 * main.js - tabview runtime / boot orchestrator.
 *
 * Owns the YouTube watch-page tabview overlay: it injects a tab strip
 * (info / comments / videos) into the right-rail of ytd-watch-flexy,
 * swaps the default description and chat into the chosen tab, and
 * patches a number of ytd-* custom-element prototype methods to keep
 * layout, comments, engagement panels, and chat in sync.
 *
 * Architecture:
 *   - This file is shipped as a string to a page-context <script>
 *     element (see the outer IIFE at the bottom of the file) so the
 *     tabview code can attach to YouTube's prototype-mutated custom
 *     elements directly.
 *   - Canonical services are preferred over local ownership where they
 *     exist: YouTubeSafeDOM (TrustedHTML), YouTubePlusLogger, the
 *     YouTubePlusCleanupManager, and the YouTubePlusDesignSystem
 *     StyleManager all back the relevant responsibilities.
 *   - Boot/runtime hardening: both the outer IIFE and the inner
 *     executionScript are guarded by a window-level idempotency flag
 *     so duplicate injection cannot re-register listeners or
 *     observers.
 *
 * Strict-checking readiness: the file IS included in the tsconfig
 * include list (src/ .js glob) but uses `@ts-nocheck` to
 * suppress errors. The JSDoc added here is intentionally narrow —
 * only on public boot/runtime entry points and helpers — so the
 * incremental sweep that removes `@ts-nocheck` can proceed without
 * a large surface of new typing errors at once.
 */
const VAL_ROUNDED_A1 = 12;

/**
 * Page-context boot body. Injected by the outer IIFE via GM_addElement
 * so it runs inside the YouTube page's own window. Wraps every side
 * effect in a top-level try/catch so an unexpected failure degrades
 * to "tabview disabled" rather than breaking the host page.
 *
 * @param {string} communicationKey - Per-boot nonce, only used for
 *   the injected sourceURL when dev-tools debugging is enabled.
 * @returns {void}
 */
const executionScript = _communicationKey => {
  // Boot/runtime hardening: window-level idempotency guard so a duplicate
  // re-entry (HMR, script re-injection, or accidental double-load) cannot
  // register listeners/observers twice. Mirrors the same pattern used in
  // basic.js / time.js (window.__ytpBasicInitDone__ / window.__ytpTimeInitDone__).
  if (typeof window !== 'undefined' && window.__ytpMainExecDone__) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__ytpMainExecDone__ = true;
  }

  const _ll =
    typeof window !== 'undefined' && window.YouTubePlusLogger?.createLogger
      ? window.YouTubePlusLogger.createLogger('Tabview')
      : {
          error: console.error,
          warn: console.warn,
          info: console.log,
          debug: () => {},
          log: console.log,
        };
  const _cm = typeof window !== 'undefined' ? window.YouTubePlusCleanupManager : null;
  const _safeDOM = typeof window !== 'undefined' && window.YouTubeSafeDOM;
  const _mc = typeof window !== 'undefined' && window.YouTubePlusMutationCoordinator;

  // -------------------------------------------------------------------------
  // Tab-view status bit flags — named constants for the layout state
  // machine bits used by tabsStatusCorrection, calculationFn, and
  // other functions that react to YouTube watch-page attribute changes.
  // -------------------------------------------------------------------------
  const FLAG = {
    /** Theater mode active */
    THEATER: 1,
    /** Tab (info/comments/videos) is selected */
    TAB_SELECTED: 2,
    /** Chat panel collapsed (tyt-chat=&#39;-&#39;) */
    CHAT_COLLAPSED: 4,
    /** Chat panel expanded (tyt-chat=&#39;+&#39;) */
    CHAT_EXPANDED: 8,
    /** Two-column layout active */
    TWO_COLUMNS: 16,
    /** Engagement panel open */
    ENGAGEMENT_PANEL: 32,
    /** Fullscreen mode */
    FULLSCREEN: 64,
    /** Playlist expanded */
    PLAYLIST: 128,
    /** External YTLSTM integration active */
    EXTERNAL_YTLSTM: 4096,
    /** All standard flags (excludes EXTERNAL_YTLSTM) */
    ALL_STANDARD: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128,
    /** All flags including external integration */
    ALL: 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128 | 4096,
  };

  const isTabviewEnabled = () => {
    try {
      const store = typeof window !== 'undefined' ? window.YouTubePlusSettingsStore : null;
      if (store && typeof store.get === 'function') {
        const v = store.get('enableTabview');
        return v !== false;
      }
      const local =
        typeof localStorage !== 'undefined' ? localStorage.getItem('youtube_plus_settings') : null;
      if (local) {
        const parsed = JSON.parse(local);
        return parsed ? parsed.enableTabview !== false : true;
      }
    } catch (_) {
      // Ignore
    }
    return true;
  };

  // Trusted Types hardening: install a `default` policy on the page's
  // window.trustedTypes so plain-string assignments to TT sinks
  // (innerHTML, setHTMLUnsafe, Range.createContextualFragment, etc.)
  // do not throw on hosts that enforce TT with `require-trusted-types-for`.
  //
  // safe-dom.js is loaded earlier in build.order.json and has already
  // installed its named policy on the userscript context. When that
  // canonical policy is reachable in this trust boundary (the normal
  // case, via `window.YouTubeSafeDOM` from `unsafeWindow`), we delegate
  // the default policy's createHTML / createScriptURL to it so the
  // default fallback is at least as defensive as safe-dom itself
  // (script / iframe / object / embed tags, on*= handlers, and
  // `javascript:` / `data:text/html` URLs are stripped).
  //
  // If the canonical policy is not reachable here, we degrade to the
  // previous identity behaviour (createHTML passes through unchanged).
  // This is strictly no worse than the prior code, and the boot probe
  // below will surface any resulting sink-type mismatch as a clear
  // bail-out.
  if (typeof trustedTypes !== 'undefined' && trustedTypes.defaultPolicy === null) {
    const canonicalPolicy =
      _safeDOM && typeof _safeDOM.getTrustedTypesPolicy === 'function'
        ? _safeDOM.getTrustedTypesPolicy()
        : null;
    let _createHTMLReentrant = false;
    const safeCreateHTML = html => {
      if (_createHTMLReentrant) {
        return typeof html === 'string' ? html : String(html == null ? '' : html);
      }
      _createHTMLReentrant = true;
      try {
        const value = typeof html === 'string' ? html : String(html == null ? '' : html);
        return canonicalPolicy && typeof canonicalPolicy.createHTML === 'function'
          ? canonicalPolicy.createHTML(value)
          : value;
      } finally {
        _createHTMLReentrant = false;
      }
    };
    const safeCreateScriptURL = url => {
      const value = typeof url === 'string' ? url : String(url == null ? '' : url);
      return canonicalPolicy && typeof canonicalPolicy.createScriptURL === 'function'
        ? canonicalPolicy.createScriptURL(value)
        : value;
    };
    try {
      trustedTypes.createPolicy('default', {
        createHTML: safeCreateHTML,
        createScriptURL: safeCreateScriptURL,
        createScript: () => {
          throw new Error('Script creation not allowed by YouTube Plus TT policy');
        },
      });
    } catch (_e) {
      // Policy name collision or TT restriction â€” fall through. The
      // boot probe below will report any sink-type mismatch.
    }
  }

  /**
   * Wrap a string as TrustedHTML (or a plain string on hosts without
   * Trusted Types). Delegates to the canonical safe-dom service when
   * present; falls back to the raw string only on the narrow path
   * where safe-dom is not reachable in the current trust boundary.
   *
   * The `default` Trusted Types policy installed above keeps
   * plain-string assignments to innerHTML permissive on hosts that
   * enforce TT, so this fallback is safe at the assignment site even
   * when the canonical service is absent.
   * @param {string} s
   * @returns {string|unknown}
   */
  function createHTML(s) {
    if (_safeDOM && typeof _safeDOM.createTrustedHTML === 'function') {
      return _safeDOM.createTrustedHTML(s);
    }
    return s;
  }

  let trustHTMLErr = null;
  try {
    const probe = document.createElement('div');
    if (_safeDOM && typeof _safeDOM.createFragment === 'function') {
      probe.appendChild(_safeDOM.createFragment(createHTML('1')));
    } else {
      probe.textContent = createHTML('1');
    }
  } catch (e) {
    trustHTMLErr = e;
  }

  if (trustHTMLErr) {
    _ll.error('trustHTMLErr', trustHTMLErr);
    // Bail out: the host enforces a Trusted Types policy that our
    // default-policy bridge cannot satisfy. Skip the main body so the
    // outer try/catch does not see a second error. End-user behavior
    // is preserved: tabview is disabled with the same logged error.
    return;
  }

  try {
    let _executionFinished = 0;

    if (typeof CustomElementRegistry === 'undefined') return;
    if (CustomElementRegistry.prototype.define000) return;
    if (typeof CustomElementRegistry.prototype.define !== 'function') return;

    /** @type {HTMLElement} */
    const HTMLElement_ = HTMLElement.prototype.constructor;

    /**
     *  @param {Element} elm
     * @param {string} selector
     * @returns {Element | null}
     *  */
    const qsOne = (elm, selector) => {
      return HTMLElement_.prototype.querySelector.call(elm, selector);
    };

    /**
     *  @param {Element} elm
     * @param {string} selector
     * @returns {NodeListOf<Element>}
     *  */
    const _qsAll = (elm, selector) => {
      return HTMLElement_.prototype.querySelectorAll.call(elm, selector);
    };

    /**
     * Define own properties on a prototype with defensive null-checking.
     * Skips any `null`/`undefined` descriptors and emits a warning so
     * the caller notices the bad entry instead of silently dropping it.
     * @param {object|null|undefined} p Target prototype (no-op when falsy).
     * @param {object} o Property descriptors keyed by name.
     * @returns {object|undefined} Result of `Object.defineProperties`, or
     *   `undefined` when `p` is falsy.
     */
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

    /**
     * Polyfill for the native `Element.replaceChildren(...)` method.
     * Removes every existing child then appends the supplied children.
     * Used as a fallback when the host prototype does not implement
     * `replaceChildren` directly.
     * @param {...Node|string} new_children Children to append after
     *   clearing the parent.
     * @returns {void}
     */
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

    Element.prototype.setAttribute111 = function (p, v) {
      v = `${v}`;
      if (this.getAttribute000(p) === v) return;
      this.setAttribute000(p, v);
    };

    Element.prototype.incAttribute111 = function (p) {
      let v = +this.getAttribute000(p) || 0;
      v = v > 1e9 ? 9 : v + 1;
      this.setAttribute000(p, `${v}`);
      return v;
    };

    Element.prototype.assignChildren111 = function (previousSiblings, node, nextSiblings) {
      // assume all previousSiblings, node, and nextSiblings are on the page
      //  -> only remove triggering is needed
      let nodeList = [];
      for (let t = this.firstChild; t instanceof Node; t = t.nextSibling) {
        if (t === node) continue;
        nodeList.push(t);
      }

      inPageRearrange = true;
      if (node.parentNode === this) {
        let fm = new DocumentFragment();
        if (nodeList.length > 0) {
          fm.replaceChildren000(...nodeList);
        }
        if (previousSiblings && previousSiblings.length > 0) {
          fm.replaceChildren000(...previousSiblings);
          this.insertBefore000(fm, node);
        }
        if (nextSiblings && nextSiblings.length > 0) {
          fm.replaceChildren000(...nextSiblings);
          this.appendChild000(fm);
        }
        fm.replaceChildren000();
        fm = null;
      } else {
        if (!previousSiblings) previousSiblings = [];
        if (!nextSiblings) nextSiblings = [];
        this.replaceChildren000(...previousSiblings, node, ...nextSiblings);
      }
      inPageRearrange = false;
      if (nodeList.length > 0) {
        for (const t of nodeList) {
          if (t instanceof Element && t.isConnected === false) t.remove(); // remove triggering
        }
      }
      nodeList.length = 0;
      nodeList = null;
    };

    let secondaryInnerHold = 0;

    const secondaryInnerFn = cb => {
      if (secondaryInnerHold) {
        secondaryInnerHold++;
        let err, r;
        try {
          r = cb();
        } catch (e) {
          err = e;
        }
        secondaryInnerHold--;
        if (err) throw err;
        return r;
      } else {
        const ea = document.querySelector('#secondary-inner');
        const eb = document.querySelector('secondary-wrapper#secondary-inner-wrapper');
        if (ea && eb) {
          secondaryInnerHold++;
          let err, r;
          ea.id = 'secondary-inner-';
          eb.id = 'secondary-inner';
          try {
            r = cb();
          } catch (e) {
            err = e;
          }
          ea.id = 'secondary-inner';
          eb.id = 'secondary-inner-wrapper';
          secondaryInnerHold--;
          if (err) throw err;
          return r;
        } else {
          return cb();
        }
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
        'undefined' !== typeof unsafeWindow ? unsafeWindow : this instanceof Window ? this : window;
      if (!e._ytConfigHacks) {
        let t = 4;
        class n extends Set {
          add(e) {
            if (t <= 0) return _ll.warn('yt.config_ is already applied on the page.');
            'function' === typeof e && super.add(e);
          }
        }
        let a = (async () => {})().constructor,
          i = (e._ytConfigHacks = new n()),
          l = () => {
            const t = e.ytcsi.originalYtcsi;
            t && ((e.ytcsi = t), (l = null));
          },
          c = null,
          o = () => {
            if (t >= 1) {
              const n = (e.yt || 0).config_ || (e.ytcfg || 0).data_ || 0;
              if ('string' === typeof n.INNERTUBE_API_KEY && 'object' === typeof n.EXPERIMENT_FLAGS)
                for (const a of (--t <= 0 && l && l(), (c = !0), i)) a(n);
            }
          },
          f = 1,
          d = t => {
            if ((t = t || e.ytcsi))
              return (
                (e.ytcsi = new Proxy(t, {
                  get: (e, t, _n) =>
                    'originalYtcsi' === t ? e : (o(), c && --f <= 0 && l?.(), e[t]),
                })),
                !0
              );
          };
        d() ||
          Object.defineProperty(e, 'ytcsi', {
            get() {},
            set: t => (t && (delete e.ytcsi, d(t)), !0),
            enumerable: !1,
            configurable: !0,
          });
        const { addEventListener: s, removeEventListener: y } = Document.prototype;
        /**
         * One-shot DOMContentLoaded handler. Flushes the YouTube
         * config bridge once and detaches itself from the listener.
         * @param {Event} [_t] Optional DOMContentLoaded event (unused
         *   beyond the listener-remove flag).
         * @returns {void}
         */
        function r(_t) {
          o(), _t && e.removeEventListener('DOMContentLoaded', r, !1);
        }
        new a(e => {
          if ('undefined' !== typeof AbortSignal)
            s.call(document, 'yt-page-data-fetched', e, { once: !0 }),
              s.call(document, 'yt-navigate-finish', e, { once: !0 }),
              s.call(document, 'spfdone', e, { once: !0 });
          else {
            /**
             * Three-event listener that fires the user callback and
             * cleans up its own registrations. Used as the
             * non-AbortSignal fallback for the navigation/ready
             * signal chain.
             * @returns {void}
             */
            const t = () => {
              e(),
                y.call(document, 'yt-page-data-fetched', t, !1),
                y.call(document, 'yt-navigate-finish', t, !1),
                y.call(document, 'spfdone', t, !1);
            };
            s.call(document, 'yt-page-data-fetched', t, !1),
              s.call(document, 'yt-navigate-finish', t, !1),
              s.call(document, 'spfdone', t, !1);
          }
        }).then(o),
          new a(e => {
            if ('undefined' !== typeof AbortSignal)
              s.call(document, 'yt-action', e, { once: !0, capture: !0 });
            else {
              /**
               * Single-event listener that fires the user callback
               * and cleans up its own registration. Used as the
               * non-AbortSignal fallback for the `yt-action` signal.
               * @returns {void}
               */
              const t = () => {
                e(), y.call(document, 'yt-action', t, !0);
              };
              s.call(document, 'yt-action', t, !0);
            }
          }).then(o),
          a.resolve().then(() => {
            'loading' !== document.readyState ? r() : e.addEventListener('DOMContentLoaded', r, !1);
          });
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

    // ==============================================================================================================================================================================================================================================================================

    /* globals WeakRef:false */

    /** @type {(o: Object | null) => WeakRef | null} */
    const mWeakRef =
      typeof WeakRef === 'function' ? o => (o ? new WeakRef(o) : null) : o => o || null; // typeof InvalidVar == 'undefined'

    /** @type {(wr: Object | null) => Object | null} */
    const kRef = wr => (wr?.deref ? wr.deref() : wr);

    /** @type {globalThis.PromiseConstructor} */
    const Promise = (async () => {})().constructor; // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

    /**
     * Return a promise that resolves after `delay` ms.
     * @param {number} delay Milliseconds to wait.
     * @returns {Promise<void>}
     */
    const delayPn = delay => new Promise(fn => setTimeout(fn, delay));

    /**
     * Resolve the Polymer/Lit controller instance (`polymerController`,
     * `inst`) from a custom-element host or return a falsy sentinel.
     * Used throughout the tabview code to reach into YouTube's internal
     * element state without relying on `.__data` or `.__reactProps$...`.
     * @param {Object|null|undefined} o A custom-element DOM node.
     * @returns {Object|null|0} The controller object, `null`, or `0`.
     */
    const insp = o => (o ? o.polymerController || o.inst || o || 0 : o || 0);

    const setTimeout_ = setTimeout.bind(window);

    /**
     * Check whether a media element (video/audio) is actively playing.
     * @param {HTMLMediaElement} media
     * @returns {boolean}
     */
    const isVideoPlaying = media => {
      return media.paused === false && media.readyState > 2 && !media.ended;
    };

    /**
     * Like `Element.closest()` but traverses shadow DOM boundaries.
     * Walks up the DOM tree through shadow roots to find the nearest
     * ancestor matching the given CSS selector.
     * @this {Element}
     * @param {string} selector CSS selector to match.
     * @returns {Element|null} The matching ancestor, or null.
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
     * Like `Element.querySelector()` but traverses shadow DOM boundaries.
     * Searches the element and all nested shadow roots for a match.
     * @this {Element}
     * @param {string} selector CSS selector to match.
     * @returns {Element|null} The first matching descendant, or null.
     */
    const _querySelector = function (selector) {
      const found = this.querySelector(selector);
      if (found) return found;
      const shadows = this.querySelectorAll('*');
      for (const el of shadows) {
        const root = /** @type {any} */ (el).shadowRoot;
        if (root) {
          const r = root.querySelector(selector);
          if (r) return r;
        }
      }
      return null;
    };

    /**
     * Find the parent contents renderer (YTD-COMMENTS or
     * YTD-ITEM-SECTION-RENDERER) and the index of the given element
     * within its children. Used by the live-chat comment swap logic.
     * @param {Element} element A comment renderer element.
     * @returns {{ parent: Element, index: number } | null}
     */
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

    /**
     * Hand-rolled `Promise`-shaped class that exposes its `resolve`
     * and `reject` callbacks as instance methods. Used when a code
     * path needs the eventual-result semantics of a Promise but also
     * needs to fire the resolution from arbitrary places (not just
     * inside the executor). The instance also implements `.then`
     * so it composes with regular `await` and `.then` chains.
     * @param {Function} [resolve_] Initial resolve stub (overwritten
     *   on first `h(resolve, reject)` call).
     * @param {Function} [reject_] Initial reject stub (overwritten on
     *   the first `h(resolve, reject)` call).
     * @returns {PromiseExternal} Constructed instance.
     */
    const PromiseExternal = ((resolve_, reject_) => {
      /**
       * Bind the real resolve and reject callbacks to the instance.
       * Called exactly once by the user of the PromiseExternal pattern
       * to hand control over when the promise settles.
       * @param {Function} resolve Resolve callback.
       * @param {Function} reject Reject callback.
       * @returns {void}
       */
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

    // ------------------------------------------------------------------------ nextBrowserTick ------------------------------------------------------------------------
    // nextBrowserTick microtask scheduler polyfill. The original used a
    // self-referential `var` (hoisted to `undefined` before the right-hand
    // side was evaluated) to detect a previous boot's instance. To stay
    // strict-mode-clean and TDZ-free, we look up any prior global install
    // explicitly via `globalThis` first; the first boot installs the
    // polyfill and later boots reuse it. `nextBrowserTick` is then a
    // stable `const` reference for the lifetime of the page-context script.
    const _existingNextBrowserTick =
      typeof globalThis !== 'undefined' && globalThis.nextBrowserTick
        ? globalThis.nextBrowserTick
        : null;
    const nextBrowserTick =
      _existingNextBrowserTick && _existingNextBrowserTick.version >= 2
        ? _existingNextBrowserTick
        : (() => {
            const e =
              'undefined' !== typeof self ? self : 'undefined' !== typeof global ? global : this;
            const _tickOrigin = (typeof location !== 'undefined' && location.origin) || '*';
            let t = !0;
            if (
              !(function n(s) {
                return s
                  ? (t = !1)
                  : e.postMessage && !e.importScripts && e.addEventListener
                    ? (e.addEventListener('message', n, !1),
                      e.postMessage('$$$', _tickOrigin),
                      e.removeEventListener('message', n, !1),
                      t)
                    : void 0;
              })()
            )
              return void _ll.warn('Your browser environment cannot use nextBrowserTick');
            /**
             * Reference to the `AsyncFunction` constructor. Used to
             * Reference to the native `Promise` constructor.
             * @type {PromiseConstructor}
             */
            const n = (async () => {})().constructor;
            let s = null;
            const o = new Map(),
              { floor: r, random: i } = Math;
            let l;
            do {
              l = `$$nextBrowserTick$$${(i() + 8).toString().slice(2)}$$`;
            } while (l in e);
            const a = l,
              c = a.length + 9;
            e[a] = 1;
            e.addEventListener(
              'message',
              e => {
                if (0 !== o.size) {
                  const t = (e || 0).data;
                  if (
                    'string' === typeof t &&
                    t.length === c &&
                    e.source === (e.target || 1) &&
                    (!e.origin || e.origin === _tickOrigin)
                  ) {
                    const e = o.get(t);
                    e && ('p' === t[0] && (s = null), o.delete(t), e());
                  }
                }
              },
              !1
            );
            /**
             * Resolved-promise polyfill used as the `nextBrowserTick`
             * implementation. Caches the last scheduled microtask so
             * a single shared tick can deliver every queued callback.
             * @param {Function} [cb] Optional callback to register on
             *   the next tick; defaults to the no-op sentinel `o`.
             * @returns {Promise|undefined} A cached microtask Promise, or
             *   `undefined` when invoked with no arguments and no tick
             *   is currently scheduled.
             */
            const d = (cb = o) => {
              if (cb === o) {
                if (s) return s;
                let t;
                do {
                  t = `p${a}${r(314159265359 * i() + 314159265359).toString(36)}`;
                } while (o.has(t));
                return (
                  (s = new n(resolve => {
                    o.set(t, resolve);
                  })),
                  e.postMessage(t, _tickOrigin),
                  (t = null),
                  s
                );
              }
              {
                let n;
                do {
                  n = `f${a}${r(314159265359 * i() + 314159265359).toString(36)}`;
                } while (o.has(n));
                o.set(n, cb), e.postMessage(n, _tickOrigin);
              }
            };
            return (d.version = 2), d;
          })();

    if (typeof globalThis !== 'undefined') globalThis.nextBrowserTick = nextBrowserTick;

    // ------------------------------------------------------------------------ nextBrowserTick ------------------------------------------------------------------------

    const isPassiveArgSupport = typeof IntersectionObserver === 'function';
    const _bubblePassive = isPassiveArgSupport ? { capture: false, passive: true } : false;
    const capturePassive = isPassiveArgSupport ? { capture: true, passive: true } : true;

    /**
     * Bitmask-based attribute state tracker. Accepts a list of attribute
     * names and exposes `makeString()` which concatenates every name whose
     * corresponding bit is set in `this.flag`. Used to build ad-hoc CSS
     * class or attribute values from a compact numeric mask.
     */
    class Attributer {
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

    /** @type {Object.<string, Element | null>} */
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
     * Resolve the `[tyt-main-info]` element that hosts the main watch
     * metadata block. The element may be the expander itself (when
     * marked) or a descendant queryable via the canonical selector.
     * @returns {Element|null} The main info element, or `null` when
     *   the expander is not mounted yet.
     */
    const getMainInfo = () => {
      const infoExpander = elements.infoExpander;
      if (!infoExpander) return null;
      const mainInfo = infoExpander.matches('[tyt-main-info]')
        ? infoExpander
        : infoExpander.querySelector000('[tyt-main-info]');
      return mainInfo || null;
    };
    let pageType = null;

    const i18nT = window.YouTubePlusI18n?.t || (k => k);

    const svgComments = `<path d="M80 27H12A12 12 90 0 0 0 39v42a12 12 90 0 0 12 12h12v20a2 2 90 0 0 3.4 2L47 93h33a12 12 90 0 0 12-12V39a12 12 90 0 0-12-12zM20 47h26a2 2 90 1 1 0 4H20a2 2 90 1 1 0-4zm52 28H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm0-12H20a2 2 90 1 1 0-4h52a2 2 90 1 1 0 4zm36-58H40a12 12 90 0 0-12 12v6h52c9 0 16 7 16 16v42h0v4l7 7a2 2 90 0 0 3-1V71h2a12 12 90 0 0 12-12V17a12 12 90 0 0-12-12z"/>`;
    const svgVideos = `<path d="M89 10c0-4-3-7-7-7H7c-4 0-7 3-7 7v70c0 4 3 7 7 7h75c4 0 7-3 7-7V10zm-62 2h13v10H27V12zm-9 66H9V68h9v10zm0-56H9V12h9v10zm22 56H27V68h13v10zm-3-25V36c0-2 2-3 4-2l12 8c2 1 2 4 0 5l-12 8c-2 1-4 0-4-2zm25 25H49V68h13v10zm0-56H49V12h13v10zm18 56h-9V68h9v10zm0-56h-9V12h9v10z"/>`;
    const svgInfo = `<path d="M30 0C13.3 0 0 13.3 0 30s13.3 30 30 30 30-13.3 30-30S46.7 0 30 0zm6.2 46.6c-1.5.5-2.6 1-3.6 1.3a10.9 10.9 0 0 1-3.3.5c-1.7 0-3.3-.5-4.3-1.4a4.68 4.68 0 0 1-1.6-3.6c0-.4.2-1 .2-1.5a20.9 20.9 90 0 1 .3-2l2-6.8c.1-.7.3-1.3.4-1.9a8.2 8.2 90 0 0 .3-1.6c0-.8-.3-1.4-.7-1.8s-1-.5-2-.5a4.53 4.53 0 0 0-1.6.3c-.5.2-1 .2-1.3.4l.6-2.1c1.2-.5 2.4-1 3.5-1.3s2.3-.6 3.3-.6c1.9 0 3.3.6 4.3 1.3s1.5 2.1 1.5 3.5c0 .3 0 .9-.1 1.6a10.4 10.4 90 0 1-.4 2.2l-1.9 6.7c-.2.5-.2 1.1-.4 1.8s-.2 1.3-.2 1.6c0 .9.2 1.6.6 1.9s1.1.5 2.1.5a6.1 6.1 90 0 0 1.5-.3 9 9 90 0 0 1.4-.4l-.6 2.2zm-3.8-35.2a1 1 0 010 8.6 1 1 0 010-8.6z"/>`;
    const svgPlayList = `<path d="M0 3h12v2H0zm0 4h12v2H0zm0 4h8v2H0zm16 0V7h-2v4h-4v2h4v4h2v-4h4v-2z"/>`;

    /**
     * Build an `<svg>` element string with the supplied dimensions and
     * inner path markup. Used by the tab HTML builder to inline the
     * small YouTube-style icons next to each tab label.
     * @param {number|string} w Rendered width in pixels.
     * @param {number|string} h Rendered height in pixels.
     * @param {number|string} vw viewBox width (intrinsic width).
     * @param {number|string} vh viewBox height (intrinsic height).
     * @param {string} p Inner markup (e.g. a `<path>` element).
     * @param {string} [m] Optional class name to apply to the wrapper.
     * @returns {string} HTML string for the `<svg>` element.
     */
    const svgElm = (w, h, vw, vh, p, m) =>
      `<svg${m ? ` class=${m}` : ''} width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;

    const hiddenTabsByUserCSS = 0;

    /**
     * Render the tabview strip (info / comments / videos / playlist) as
     * a static HTML string. The string is parsed by the mutation
     * coordinator through a detached `<template>` and inserted into the
     * right rail of `ytd-watch-flexy`. Markup is fully under our
     * control; no user data is interpolated without escaping.
     * @returns {string} HTML for the `#right-tabs` block.
     */
    function getTabsHTML() {
      const sTabBtnVideos = `${svgElm(16, 16, 90, 90, svgVideos)}<span>${i18nT('videos')}</span>`;
      const sTabBtnInfo = `${svgElm(16, 16, 60, 60, svgInfo)}<span>${i18nT('info')}</span>`;
      const sTabBtnPlayList = `${svgElm(16, 16, 20, 20, svgPlayList)}<span>${i18nT('playlist')}</span>`;

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

    /**
     * Mirror the active language onto `<html data-ytplus-lang>` so CSS
     * and other modules can read it without depending on the i18n
     * service directly. Falls back to `document.documentElement.lang`
     * and finally to `en`. Errors are swallowed — language detection is
     * non-critical for tabview functionality.
     * @returns {void}
     */
    const setLangForPage = () => {
      try {
        const lang =
          window.YouTubePlusI18n?.getLanguage?.() || document.documentElement?.lang || 'en';
        document.documentElement?.setAttribute('data-ytplus-lang', lang);
      } catch (_e) {
        // non-critical
      }
    };

    /** @type {Object.<string, number>} */
    const _locks = {};

    /**
     * Read-only proxy to the lock counter map. Every read returns
     * the current lock value (or 0 if unset). Writes are silently
     * ignored — use `lockSet` to increment.
     * @type {Readonly<Record<string, number>>}
     */
    const lockGet = new Proxy(_locks, {
      get(target, prop) {
        return target[prop] || 0;
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    /**
     * Write-only proxy to the lock counter map. Every property read
     * atomically increments the counter (wrapping at 1e9 → 9) and
     * returns the new value. Used as a lock sequencing mechanism:
     * capture a lockId via `lockSet.lockName`, and check it later
     * with `lockGet.lockName` to detect concurrent re-entry.
     * @type {Record<string, number>}
     */
    const lockSet = new Proxy(_locks, {
      get(target, prop) {
        if (target[prop] > 1e9) target[prop] = 9;
        return (target[prop] = (target[prop] || 0) + 1);
      },
      set(_target, _prop, _val) {
        return true;
      },
    });

    let videosElementProvidedPromise = new PromiseExternal();
    let navigateFinishedPromise = new PromiseExternal();

    let isRightTabsInserted = false;
    let rightTabsProvidedPromise = new PromiseExternal();

    let infoExpanderElementProvidedPromise = new PromiseExternal();

    /**
     * Re-wire the one-shot tabview insertion promises. This is needed when the
     * page leaves a watch page and later returns (e.g. watch → channel →
     * refresh → back to watch, or refresh → navigate to watch), because
     * PromiseExternal instances can only resolve once. Without a reset the
     * insertion chain would never fire again.
     */
    const resetTabviewInsertPromises = () => {
      isRightTabsInserted = false;
      // Re-create the PromiseExternal instances so a fresh watch-page visit
      // can resolve them again. We must re-wire the Promise.all listeners
      // each time so they observe the new promise objects.
      videosElementProvidedPromise = new PromiseExternal();
      navigateFinishedPromise = new PromiseExternal();
      rightTabsProvidedPromise = new PromiseExternal();
      infoExpanderElementProvidedPromise = new PromiseExternal();

      // Clear cached element references from the previous watch page so that
      // onceInsertRightTabs uses the newly navigated DOM, not stale nodes.
      elements.related = null;
      elements.comments = null;
      elements.infoExpander = null;
      elements.flexy = null;
      elements.chat = null;
      elements.playlist = null;

      // Re-subscribe the insertion chain to the fresh promises.
      Promise.all([videosElementProvidedPromise, navigateFinishedPromise])
        .then(eventMap.onceInsertRightTabs)
        .catch(_ll.warn);
      Promise.all([navigateFinishedPromise, infoExpanderElementProvidedPromise])
        .then(eventMap.onceInfoExpanderElementProvidedPromised)
        .catch(_ll.warn);
    };

    const pluginsDetected = {};
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

    // Route the plugin-detection attribute watcher through the shared
    // mutation coordinator so we don't add a dedicated MutationObserver
    // to the page. The coordinator already batches root mutations through
    // requestAnimationFrame and unifies the attribute filter.
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
    } else {
      const pluginDetectObserver = new MutationObserver(onPluginMutation);
      pluginDetectObserver.observe(document.documentElement, {
        attributes: true,
      });
      if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
      _cm?.registerObserver?.(pluginDetectObserver);
      navigateFinishedPromise.then(() => {
        pluginDetectObserver.observe(document.documentElement, {
          attributes: true,
        });
        if (document.body) pluginDetectObserver.observe(document.body, { attributes: true });
      });
    }

    /**
     * Decide whether the current yt-formatted-string node can be
     * collapsed. Reads the content from the host element's polymer
     * `$.content` property, falling back to `this.content` for the
     * non-polymer prototype.
     * @returns {boolean} `true` if the node is eligible for collapse.
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

    // Single shared mutation coordinator (YouTubePlusMutationCoordinator) is
    // the canonical owner of MutationObserver instances. The handlers
    // below are routed through `watchTarget` so attribute changes on
    // the chat, playlist, and comments elements share the coordinator's
    // one root observer. Each handler is unbound via its own subId when
    // the corresponding element detaches.
    /**
     * Mutation handler for the chat element. Coalesces every attribute
     * change into one promise-tick invocation of `aoChatAttrChangeFn`
     * to keep the heavy re-layout work off the mutation callback path.
     * @returns {void}
     */
    const onAoChatMutation = () => {
      Promise.resolve(lockSet.aoChatAttrAsyncLock).then(aoChatAttrChangeFn).catch(_ll.warn);
    };
    let aoChatSubId = null;
    //   Promise.resolve(lockSet['aoInfoAttrAsyncLock']).then(aoInfoAttrChangeFn).catch(_ll.warn);
    // });
    //   Promise.resolve(lockSet['zoInfoAttrAsyncLock']).then(zoInfoAttrChangeFn).catch(_ll.warn);
    // });
    /**
     * Mutation handler for the playlist element. Same coalescing
     * pattern as `onAoChatMutation`: a single async invocation per
     * mutation batch keeps the playlist layout logic out of the hot
     * mutation path.
     * @returns {void}
     */
    const onAoPlayListMutation = () => {
      Promise.resolve(lockSet.aoPlayListAttrAsyncLock).then(aoPlayListAttrChangeFn).catch(_ll.warn);
    };
    let aoPlayListSubId = null;

    const onAoCommentMutation = async mutations => {
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
          Promise.resolve(commentsArea).then(eventMap.settingCommentsVideoId).catch(_ll.warn);
        }

        Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
          .then(removeKeepCommentsScroller)
          .catch(_ll.warn);
      }

      if ((bfHidden || bfCommentsVideoId || bfCommentDisabled) && ytdFlexyElm) {
        const commentsDataStatus = +commentsArea.getAttribute000('tyt-comments-data-status');
        if (commentsDataStatus === 2) {
          ytdFlexyElm.setAttribute111('tyt-comment-disabled', '');
        } else if (commentsDataStatus === 1) {
          ytdFlexyElm.removeAttribute000('tyt-comment-disabled');
        }

        Promise.resolve(lockSet.checkCommentsShouldBeHiddenLock)
          .then(eventMap.checkCommentsShouldBeHidden)
          .catch(_ll.warn);

        const lockId = lockSet.rightTabReadyLock01;
        await rightTabsProvidedPromise.then();
        if (lockGet.rightTabReadyLock01 !== lockId) return;

        if (elements.comments !== commentsArea) return;
        if (commentsArea.isConnected === false) return;

        if (commentsArea.closest('#tab-comments')) {
          const shouldTabVisible = !commentsArea.closest('[hidden]');
          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);
        }
      }
    };
    let aoCommentSubId = null;

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
    );

    let bFixForResizedTabLater = false;
    let lastRoRightTabsWidth = 0;
    const roRightTabs = new ResizeObserver(entries => {
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
    });

    const switchToTab = activeLink => {
      if (typeof activeLink === 'string') {
        activeLink = document.querySelector(`a[tyt-tab-content="${activeLink}"]`) || null;
      }

      const ytdFlexyElm = elements.flexy;

      const links = document.querySelectorAll('#material-tabs a[tyt-tab-content]');

      for (const link of links) {
        const content = document.querySelector(link.getAttribute000('tyt-tab-content'));
        if (link && content) {
          if (link !== activeLink) {
            link.classList.remove('active');
            content.classList.add('tab-content-hidden');
            if (!content.hasAttribute000('tyt-hidden')) {
              content.setAttribute111('tyt-hidden', ''); // for https://greasyfork.org/en/scripts/456108
            }
          } else {
            link.classList.add('active');
            if (content.hasAttribute000('tyt-hidden')) {
              content.removeAttribute000('tyt-hidden'); // for https://greasyfork.org/en/scripts/456108
            }
            content.classList.remove('tab-content-hidden');
          }
        }
      }

      const switchingTo = activeLink ? activeLink.getAttribute000('tyt-tab-content') : '';
      if (switchingTo) {
        lastTab = lastPanel = switchingTo;
      }

      if (ytdFlexyElm.getAttribute000('tyt-chat') === '')
        ytdFlexyElm.removeAttribute000('tyt-chat');
      ytdFlexyElm.setAttribute111('tyt-tab', switchingTo);

      if (switchingTo) {
        bFixForResizedTabLater = false;
        Promise.resolve(0).then(eventMap.fixForTabDisplay);
      }
    };

    let tabAStatus = 0;
    /**
     * Compute the current tab-view status bitmask from the flag
     * argument and the live `ytd-flexy` host attributes. Each bit
     * tracks one aspect of the page layout (theater, playlist, chat
     * panel visibility, etc.) that the tabview logic reacts to.
     * @param {number} r Accumulator carried across the call chain.
     * @param {number} flag Bitmask of state to test against the live host.
     * @returns {number} Updated accumulator reflecting the live state.
     */
    const calculationFn = (r, flag) => {
      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return r;
      if (flag & FLAG.THEATER) {
        r |= FLAG.THEATER;
        if (!ytdFlexyElm.hasAttribute000('theater')) r -= FLAG.THEATER;
      }
      if (flag & FLAG.TAB_SELECTED) {
        r |= FLAG.TAB_SELECTED;
        if (!ytdFlexyElm.getAttribute000('tyt-tab')) r -= FLAG.TAB_SELECTED;
      }
      if (flag & FLAG.CHAT_COLLAPSED) {
        r |= FLAG.CHAT_COLLAPSED;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '-') r -= FLAG.CHAT_COLLAPSED;
      }
      if (flag & FLAG.CHAT_EXPANDED) {
        r |= FLAG.CHAT_EXPANDED;
        if (ytdFlexyElm.getAttribute000('tyt-chat') !== '+') r -= FLAG.CHAT_EXPANDED;
      }
      if (flag & FLAG.TWO_COLUMNS) {
        r |= FLAG.TWO_COLUMNS;
        if (!ytdFlexyElm.hasAttribute000('is-two-columns_')) r -= FLAG.TWO_COLUMNS;
      }
      if (flag & FLAG.ENGAGEMENT_PANEL) {
        r |= FLAG.ENGAGEMENT_PANEL;
        if (!ytdFlexyElm.hasAttribute000('tyt-egm-panel_')) r -= FLAG.ENGAGEMENT_PANEL;
      }
      if (flag & FLAG.FULLSCREEN) {
        r |= FLAG.FULLSCREEN;
        if (!document.fullscreenElement) r -= FLAG.FULLSCREEN;
      }
      if (flag & FLAG.PLAYLIST) {
        r |= FLAG.PLAYLIST;
        if (!ytdFlexyElm.hasAttribute000('tyt-playlist-expanded')) r -= FLAG.PLAYLIST;
      }
      if (flag & FLAG.EXTERNAL_YTLSTM) {
        r |= FLAG.EXTERNAL_YTLSTM;
        if (ytdFlexyElm.getAttribute('tyt-external-ytlstm') !== '1') r -= FLAG.EXTERNAL_YTLSTM;
      }
      return r;
    };

    /**
     * Report whether the watch page is currently in theater mode.
     * @returns {boolean|undefined} `true` when the host flexy element
     *   has the `theater` attribute; `false`/undefined otherwise.
     */
    function isTheater() {
      const ytdFlexyElm = elements.flexy;
      return ytdFlexyElm?.hasAttribute000('theater');
    }

    /**
     * Enter theater mode by clicking the host's size button if the
     * page is not already in theater mode. No-op when the host does
     * not have a `ytd-player` size button mounted yet.
     * @returns {void}
     */
    function _ytBtnSetTheater() {
      if (!isTheater()) {
        const sizeBtn = document.querySelector(
          'ytd-watch-flexy #ytd-player button.ytp-size-button'
        );
        if (sizeBtn) sizeBtn.click();
      }
    }

    /**
     * Exit theater mode by clicking the size button if the page is
     * currently in theater mode.
     * @returns {void}
     */
    function ytBtnCancelTheater() {
      if (isTheater()) {
        const sizeBtn = document.querySelector(
          'ytd-watch-flexy #ytd-player button.ytp-size-button'
        );
        if (sizeBtn) sizeBtn.click();
      }
    }

    /**
     * Find the "most-populated" element matching `selector` — the
     * element with the deepest descendant tree — useful when YouTube
     * reuses a tag name across multiple views and we want the live
     * one in the document.
     * @param {string} selector CSS selector to search for.
     * @returns {Element|null} Best candidate, or `null` when none match.
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
     * Expand the live chat panel by calling the host controller's
     * `setCollapsedState` action (when available) and falling back to
     * clicking the show/hide button. No-op when the chat is already
     * expanded or has not been mounted.
     * @returns {void}
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
        if (button) button.click();
      }
    }

    /**
     * Collapse the live chat panel using the same dispatch strategy
     * as `ytBtnExpandChat`. Toggles the controller state first and
     * then falls back to clicking the show/hide button.
     * @returns {void}
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
        if (button) button.click();
      }
    }

    /**
     * Apply a batch of engagement-panel `updateEgmPanel` actions to
     * the live `ytd-flexy` host. Accepts either a single action object
     * or an array; coerces a non-array into a one-element list. Each
     * action targets a `ytd-engagement-panel-section-list-renderer`
     * mutation (set/unset `target-id` + `visibility`).
     * @param {object|object[]} arr Single action or list of actions.
     * @returns {void}
     */
    function ytBtnEgmPanelCore(arr) {
      if (!arr) return;
      if (!('length' in arr)) arr = [arr];

      const ytdFlexyElm = elements.flexy;
      if (!ytdFlexyElm) return;

      let actions = [];

      for (const entry of arr) {
        if (!entry) continue;

        const panelId = entry.panelId;

        const toHide = entry.toHide;
        const toShow = entry.toShow;

        if (toHide === true && !toShow) {
          /*
          actions.push({
            "changeEngagementPanelVisibilityAction": {
              "targetId": panelId,
              "visibility": "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
            }
          });

          actions.push({
            "hideEngagementPanelEndpoint": {
              "identifier": panelId,
            }
          });
          */

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
      actions = null;
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

    function ytBtnCloseEngagementPanels() {
      if (isEngagementPanelExpanded()) {
        for (const s of document.querySelectorAll(
          `ytd-watch-flexy[tyt-tab] #panels.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility]:not([hidden])`
        )) {
          if (s.getAttribute('visibility') == "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED") ytBtnCloseEngagementPanel(s);
        }
      }
    }
    */

    /**
     * Resolve a stable identifier for an engagement panel element.
     * Tries the polymer data fields in order: `data.panelIdentifier`,
     * then `data.identifier.tag`, then `data.targetId`, and finally
     * the live `target-id` attribute. Returns an empty string when
     * nothing matches.
     * @param {Element} panelElm The engagement panel element.
     * @returns {string} The best-known identifier for the panel.
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

    /**
     * Hide every currently-expanded engagement panel by routing a
     * batch of close actions through `ytBtnEgmPanelCore`. Skips
     * panels inside a `[hidden]` ancestor so the live DOM state is
     * respected.
     * @returns {void}
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
          const pid = getPanelIdentifier(panelElm);
          actions.push({
            panelId: pid,
            toHide: true,
          });
        }
      }
      ytBtnEgmPanelCore(actions);
    }

    /**
     * Open the watch-page playlist (collapse = false). No-op when the
     * playlist element has not been mounted yet.
     * @returns {void}
     */
    function ytBtnOpenPlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = false;
      }
    }
    /**
     * Close the watch-page playlist (collapse = true). No-op when the
     * playlist element has not been mounted yet.
     * @returns {void}
     */
    function ytBtnClosePlaylist() {
      const cnt = insp(elements.playlist);
      if (cnt && typeof cnt.collapsed === 'boolean') {
        cnt.collapsed = true;
      }
    }

    /**
     * Patch the live chat's grid renderer to keep the secondary
     * chat element attached to the flexy host. Bails out when the
     * `this.is` tag is not `ytd-watch-grid` (i.e. another host
     * inherited this method via prototype patching).
     * @returns {void}
     */
    const updateChatLocation498 = function () {
      if (this.is !== 'ytd-watch-grid') {
        secondaryInnerFn(() => {
          this.updatePageMediaQueries();
          this.schedulePlayerSizeUpdate_();
        });
      }
    };

    /**
     * WeakMap from source elements to their WeakRef-wrapped mirror
     * (clone) nodes. Used by the info-panel mirror system to keep
     * the tabview's secondary content in sync without leaking DOM
     * references after SPA navigation.
     * @type {WeakMap<Element, WeakRef>}
     */
    const mirrorNodeWS = new WeakMap();

    const dummyNode = document.createElement('noscript');

    const __j4836__ = Symbol();
    const __j5744__ = Symbol(); // original element
    const __j5733__ = Symbol(); // __lastChanged__

    /**
     * Mirror `tyt-data-change-counter` mutations back to the original
     * source element. Used as a fallback for hosts that do not expose
     * a writable data property observer; detects data updates via
     * DOM mutations and increments the counter so the rest of the
     * pipeline can react.
     * @param {MutationRecord[]} _mutations Unused (kept for the
     *   MutationObserver signature).
     * @returns {Promise<void>}
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
     * Mirror a counter increment on a clone element back to its
     * original source element. Wired up as the mutation handler for
     * the per-source attribute watcher, so when the clone's
     * `tyt-data-change-counter` ticks, the original source element
     * receives the same bump.
     * @param {MutationRecord[]} mutations Batch of attribute mutations
     *   delivered by the mutation coordinator.
     * @returns {void}
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
     * Atomically increment a numeric counter attribute on `elm` and
     * write the new value back. Wraps around to `9` once the counter
     * exceeds 1e9 to avoid unbounded growth.
     * @param {Element} elm Target element that owns the counter.
     * @param {string} prop Attribute name to increment.
     * @returns {void}
     */
    const attributeInc = (elm, prop) => {
      let v = (+elm.getAttribute000(prop) || 0) + 1;
      if (v > 1e9) v = 9;
      elm.setAttribute000(prop, v);
      return v;
    };

    /**
     * UC[-_a-zA-Z0-9+=.]{22}
     * https://support.google.com/youtube/answer/6070344?hl=en
     * The channel ID is the 24 character alphanumeric string that starts with 'UC' in the channel URL.
     */

    const isChannelId = x => {
      if (typeof x === 'string' && x.length === 24) {
        return /UC[-_a-zA-Z0-9+=.]{22}/.test(x);
      }
      return false;
    };

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
      //   if(elm.parentNode.closest('div[slot="extra-content"], ytd-metadata-row-container-renderer')) return false;
      // });

      const requireElements = [
        ...document.querySelectorAll(
          'ytd-watch-metadata.ytd-watch-flexy div[slot="extra-content"] > *, ytd-watch-metadata.ytd-watch-flexy #extra-content > *'
        ),
      ]
        .filter(elm => {
          return typeof elm.is === 'string';
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
      for (const { data, tag, elm: s } of source) {
        let mirrorNode = mirrorNodeWS.get(s);
        mirrorNode = mirrorNode ? kRef(mirrorNode) : mirrorNode;
        if (!mirrorNode) {
          const cnt = insp(s);
          const cProto = cnt.constructor.prototype;

          const element = document.createElement(tag);
          noscript.appendChild(element); // appendChild to trigger .attached()
          mirrorNode = element;
          mirrorNode[__j5744__] = mWeakRef(s);

          const nodeWR = mWeakRef(mirrorNode);

          // Route the per-source attribute watcher through the shared
          // mutation coordinator. The subId is per-source so multiple
          // mirror elements get independent subscriptions on the
          // coordinator's single root observer.
          const reflectionSubId = `main::moChangeReflection:${s.dataset?.tytSrcId || ++_moChangeReflectionCounter}`;
          if (_mc?.watchTarget) {
            _mc.watchTarget(reflectionSubId, s, moChangeReflection.bind(nodeWR), {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['tyt-clone-refresh-count', 'tyt-data-change-counter'],
            });
          } else {
            const _mo = new MutationObserver(moChangeReflection.bind(nodeWR));
            _mo.observe(s, {
              attributes: true,
              attributeFilter: ['tyt-clone-refresh-count', 'tyt-data-change-counter'],
            });
            _cm?.registerObserver?.(_mo);
          }

          s.jy8432 = 1;
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
              cProto._dataChanged496k = cnt => cnt._dataChanged496();
            }
          }

          if (!cProto._dataChanged496) {
            // Per-source subtree observer — routes through the
            // coordinator so we don't add a dedicated MutationObserver
            // for every mirror element.
            const monitorSubId = `main::monitorDataChanged:${++_monitorDataChangedCounter}`;
            if (_mc?.watchTarget) {
              _mc.watchTarget(
                monitorSubId,
                s,
                monitorDataChangedByDOMMutation.bind(mirrorNode[__j5744__]),
                { attributes: true, childList: true, subtree: true }
              );
            } else {
              const _moMonitor = new MutationObserver(
                monitorDataChangedByDOMMutation.bind(mirrorNode[__j5744__])
              );
              _moMonitor.observe(s, {
                attributes: true,
                childList: true,
                subtree: true,
              });
              _cm?.registerObserver?.(_moMonitor);
            }
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
            //   noscript.appendChild(mirrorNode);
            // }
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
        if (
          secondaryInner.firstChild !== secondaryInner.lastChild ||
          (chatContainer && !chatContainer.closest('secondary-wrapper'))
        ) {
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
              chatCnt.urlChanged();
            } else {
              setTimeout(() => chatCnt.urlChanged(), 136);
            }
          }
        }
      }
    };

    let lastPanel = '';
    let lastTab = '';

    /**
     * Mutation handler for engagement panels. Coalesces visibility /
     * hidden attribute changes into one async invocation of
     * `updateEgmPanels` so the panel re-layout runs after the current
     * mutation batch has settled.
     * @returns {void}
     */
    const onAoEgmPanelsMutation = () => {
      Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
    };
    let aoEgmPanelsSubId = null;

    const removeKeepCommentsScroller = async lockId => {
      if (lockGet.removeKeepCommentsScrollerLock !== lockId) return;
      await Promise.resolve();
      if (lockGet.removeKeepCommentsScrollerLock !== lockId) return;
      const ytdFlexyElm = elements.flexy;
      if (ytdFlexyElm) {
        ytdFlexyElm.removeAttribute000('keep-comments-scroller');
      }
    };

    const updateEgmPanels = async lockId => {
      if (lockId !== lockGet.updateEgmPanelsLock) return;
      await navigateFinishedPromise.then().catch(_ll.warn);
      if (lockId !== lockGet.updateEgmPanelsLock) return;

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
          const pid = getPanelIdentifier(panelElm);
          actions.push({
            panelId: pid,
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

    /**
     * Return the first element matching `css` that is not contained in
     * an `exclude` ancestor. Useful when YouTube's DOM reuses a class
     * inside a wrapper we want to skip.
     * @param {string} css CSS selector for the candidate elements.
     * @param {string} exclude Selector for ancestor elements to skip.
     * @returns {Element|null} First non-excluded match, or `null`.
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
       * Locate the comment renderer that owns a specific live-chat
       * comment id (`lc`). Used by the auto-route logic to scroll the
       * user to a comment thread that originated in the live chat.
       * @param {string} lc Live-chat comment id to find.
       * @returns {Element|null} The matched `ytd-comment-renderer`, or
       *   `null` when the comment is not present in the current DOM.
       */
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

      /**
       * Swap handler `A` for live-chat ↔ comments navigation. Resolves
       * the current chat comment element, then triggers a swap to the
       * matching comments thread so the user keeps visual continuity
       * when the route changes.
       * @param {string} targetLcId Live-chat id the user is moving to.
       * @param {string} currentLcId Live-chat id the user is moving from.
       * @returns {void}
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
              } else {
                const v2pCnt = insp(v2.parent);
                const v2Conents = (v2pCnt.data || 0).contents || 0;
                if (!v2Conents) _ll.warn('v2Conents is not found');

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
          _ll.warn(e);
        }
        return done === 1;
      }

      /**
       * Swap handler `B` for live-chat ↔ comments navigation. Variant
       * of `lcSwapFuncA` that supports a third positional argument
       * (`_p`) used as an opaque parent / context pointer by the
       * caller.
       * @param {string} targetLcId Live-chat id the user is moving to.
       * @param {string} currentLcId Live-chat id the user is moving from.
       * @param {*} _p Opaque context pointer (unused but reserved).
       * @returns {void}
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
          _ll.warn(e);
        }
        return done === 1;
      }

      const loadStartFx = async evt => {
        const media = evt?.target;
        if (!media || (media.nodeName !== 'VIDEO' && media.nodeName !== 'AUDIO')) return;

        const newMedia = media;

        const media1 = common.getMediaElement(0); // document.querySelector('#movie_player video[src]');
        const media2 = common.getMediaElements(2); // document.querySelectorAll('ytd-browse[role="main"] video[src]');

        if (media1 !== null && media2.length > 0) {
          if (newMedia !== media1 && media1.paused === false) {
            if (isVideoPlaying(media1)) {
              Promise.resolve(newMedia)
                .then(video => video.paused === false && video.pause())
                .catch(_ll.warn);
            }
          } else if (newMedia === media1) {
            for (const s of media2) {
              if (s.paused === false) {
                Promise.resolve(s)
                  .then(s => s.paused === false && s.pause())
                  .catch(_ll.warn);
                break;
              }
            }
          } else {
            Promise.resolve(media1)
              .then(video1 => video1.paused === false && video1.pause())
              .catch(_ll.warn);
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
                "label": "æ³¨ç›®ã®ã‚³ãƒ¡ãƒ³ãƒˆ",
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
          } else if (endpoint.commandMetadata?.webCommandMetadata) {
            const meta = endpoint.commandMetadata.webCommandMetadata;
            if (meta?.url && meta.webPageType) {
              valid = true;
            }
          }
        }

        if (!valid) endpoint = null;

        return endpoint;
      };

      /**
       * Decide whether the user is on a route that should use the
       * miniplayer tab. Returns `true` for browse pages that expose
       * a non-`home` page-subtype attribute (channel, playlist, etc.).
       * @returns {boolean} `true` when miniplayer is appropriate.
       */
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
      };

      const conditionFulfillment = req => {
        const command = req ? req.command : null;
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
            const currentVideo = common.getMediaElement(0);
            if (currentVideo && currentVideo.readyState > currentVideo.HAVE_CURRENT_DATA && currentVideo.currentTime > 2.2 && currentVideo.duration - 2.2 < currentVideo.currentTime) {
              // disable miniview browsing if the media is near to the end
              return false;
            }
          }
        */

        if (pageType !== 'watch') return false;

        // 2025.10.16 - ignore ytp-miniplayer-button existance
        // }

        return true;
      };

      let u38 = 0;
      const fixChannelAboutPopup = async t38 => {
        let promise = new PromiseExternal();
        /**
         * Defer a microtask that resolves `promise` so the calling
         * code can wait for the next paint before reading the
         * post-mutation DOM state.
         * @returns {void}
         */
        const f = () => {
          promise?.resolve();
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
              } catch (_e) {
                _ll.warn('handleGetOpenedPopupsAction_ failed', _e);
              }
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
          if (u38 > 1e9) u38 = 9;
          const t38 = ++u38;

          const $arguments = arguments;

          let endpoint = null;

          if (conditionFulfillment(req)) {
            endpoint = getBrowsableEndPoint(req);
          }

          if (!(endpoint && shouldUseMiniPlayer())) return handleNavigate.apply(this, $arguments);

          const ytdAppElm = document.querySelector('ytd-app');
          const ytdAppCnt = insp(ytdAppElm);

          let object = null;
          try {
            object = ytdAppCnt.data.response.currentVideoEndpoint.watchEndpoint || null;
          } catch (_e) {
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
                // lint:custom:ignore setTimeout-long-delay — page-context script; setTimeout_ not available here
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
              .catch(_ll.warn);
          }

          if (!isLoadStartListened) {
            isLoadStartListened = true;
            document.addEventListener('loadstart', loadStartFx, true);
          }

          const endpointURL = `${endpoint?.commandMetadata?.webCommandMetadata?.url || ''}`;

          if (
            endpointURL?.endsWith('/about') &&
            /\/channel\/UC[-_a-zA-Z0-9+=.]{22}\/about/.test(endpointURL)
          ) {
            fixChannelAboutPopup(t38);
          }

          handleNavigate.apply(this, $arguments);
        };
      };

      return { handleNavigateFactory };
    })();

    /**
     * IIFE that returns the shared `common` helper bundle used across
     * the rest of the module. Exposes the media-element resolver, the
     * miniplayer-routing helpers, and a few safe-element utilities.
     * The `mediaModeLock` is a sequence counter used to detect stale
     * resolutions and bail out of a stale request path.
     * @returns {{
     *   getMediaElement: (index?: number) => HTMLMediaElement|null,
     *   isMediaMiniplayerActive: () => boolean,
     *   isMiniPlayerActive: () => boolean,
     *   $$: <T>(selector: string, ctx?: ParentNode) => T|null
     * }} Shared helper bundle.
     */
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
            default:
              return '#movie_player video[src]';
          }
        } else if (mediaModeLock === 2) {
          switch (i) {
            case 1:
              return 'ytd-player#ytd-player audio.video-stream.html5-main-video[src]';
            case 2:
              return 'ytd-browse[role="main"] audio.video-stream.html5-main-video[src]';
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
          } catch (_e) {
            // in case error occurs if replaceState is replaced by any external script / extension
          }
          if (s.endpoint) {
            try {
              const ytdAppElm = document.querySelector('ytd-app');
              const ytdAppCnt = insp(ytdAppElm);
              ytdAppCnt.replaceState(s.endpoint, '', u);
            } catch (_e) {
              _ll.warn('replaceState failed', _e);
            }
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

    /**
     * Resolve the video id of the currently mounted watch page. Tries
     * the host element's controller (`ytdFlexyCnt.videoId`) first,
     * then falls back to the element's own `videoId` property, and
     * finally to parsing `location.href` for the `v=` query parameter.
     * @returns {string} The current video id, or an empty string.
     */
    const getCurrentVideoId = () => {
      const ytdFlexyElm = elements.flexy;
      const ytdFlexyCnt = insp(ytdFlexyElm);
      if (ytdFlexyCnt && typeof ytdFlexyCnt.videoId === 'string') return ytdFlexyCnt.videoId;
      if (ytdFlexyElm && typeof ytdFlexyElm.videoId === 'string') return ytdFlexyElm.videoId;
      _ll.info('video id not found');
      return '';
    };

    const _holdInlineExpanderAlwaysExpanded = inlineExpanderCnt => {
      _ll.info('holdInlineExpanderAlwaysExpanded');
      if (inlineExpanderCnt.alwaysShowExpandButton === true)
        inlineExpanderCnt.alwaysShowExpandButton = false;
      if (typeof (inlineExpanderCnt.collapseLabel || 0) === 'string')
        inlineExpanderCnt.collapseLabel = '';
      if (typeof (inlineExpanderCnt.expandLabel || 0) === 'string')
        inlineExpanderCnt.expandLabel = '';
      if (inlineExpanderCnt.showCollapseButton === true)
        inlineExpanderCnt.showCollapseButton = false;
      if (inlineExpanderCnt.showExpandButton === true) inlineExpanderCnt.showExpandButton = false;
      if (inlineExpanderCnt.expandButton instanceof HTMLElement_) {
        const btn = inlineExpanderCnt.expandButton;
        inlineExpanderCnt.expandButton = null;
        btn.remove();
      }
    };

    const fixInlineExpanderDisplay = inlineExpanderCnt => {
      try {
        inlineExpanderCnt.updateIsAttributedExpanded();
      } catch (_e) {
        _ll.warn('updateIsAttributedExpanded failed', _e);
      }
      try {
        inlineExpanderCnt.updateIsFormattedExpanded();
      } catch (_e) {
        _ll.warn('updateIsFormattedExpanded failed', _e);
      }
      try {
        inlineExpanderCnt.updateTextOnSnippetTypeChange();
      } catch (_e) {
        _ll.warn('updateTextOnSnippetTypeChange failed', _e);
      }
      try {
        inlineExpanderCnt.updateStyles();
      } catch (_e) {
        _ll.warn('updateStyles failed', _e);
      }
    };

    const setExpand = cnt => {
      if (typeof cnt.set === 'function') {
        cnt.set('isExpanded', true);
        if (typeof cnt.isExpandedChanged === 'function') cnt.isExpandedChanged();
      } else if (cnt.isExpanded === false) {
        cnt.isExpanded = true;
        if (typeof cnt.isExpandedChanged === 'function') cnt.isExpandedChanged();
      }
    };

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

    /**
     * Adjust the inline expander markup so the tabview description
     * block renders correctly. Resolves the main info element via
     * `getMainInfo()` and applies the YouTube-specific display tweak
     * that the description expects.
     * @returns {void}
     */
    const fixInlineExpanderContent = () => {
      const mainInfo = getMainInfo();
      if (!mainInfo) return;

      const inlineExpanderElm = mainInfo.querySelector('ytd-text-inline-expander');
      const inlineExpanderCnt = insp(inlineExpanderElm);
      fixInlineExpanderMethods(inlineExpanderCnt);

      //   // inlineExpanderCnt.isExpandedChanged();
      //   // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
      // }

      //   }
      // }
    };

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
                // holdInlineExpanderAlwaysExpanded(inlineExpanderCnt);
              }
              break;
            }
          }
        },
        activate() {
          if (this.activated) return;

          this.moFn = this.moFn.bind(this);
          // The shared mutation coordinator owns a single root observer;
          // bind a per-target handler here so attribute changes on the
          // expander element flow through the coordinator instead of a
          // dedicated MutationObserver.
          this.moSubId = null;
          this.moCallback = () => {
            Promise.resolve(lockSet.autoExpandInfoDescAttrAsyncLock)
              .then(this.moFn)
              .catch(_ll.warn);
          };
          this.activated = true;
          this.promiseReady.resolve();
        },
        async onMainInfoSet(mainInfo) {
          await this.promiseReady.then();
          if (this.moSubId && _mc?.unwatch) _mc.unwatch(this.moSubId);
          this.moSubId = 'main::autoExpandInfoDesc';
          if (_mc?.watchTarget) {
            if (mainInfo.nodeName.toLowerCase() === 'ytd-expander') {
              _mc.watchTarget(this.moSubId, mainInfo, this.moCallback, {
                attributes: true,
                childList: false,
                subtree: false,
                attributeFilter: ['collapsed', 'attr-8ifv7'],
              });
            } else {
              _mc.watchTarget(this.moSubId, mainInfo, this.moCallback, {
                attributes: true,
                childList: false,
                subtree: false,
                attributeFilter: ['attr-8ifv7'],
              });
            }
          } else {
            if (this.mo) this.mo.disconnect();
            this.mo = new MutationObserver(this.moCallback);
            if (mainInfo.nodeName.toLowerCase() === 'ytd-expander') {
              this.mo.observe(mainInfo, {
                attributes: true,
                attributeFilter: ['collapsed', 'attr-8ifv7'],
              });
            } else {
              this.mo.observe(mainInfo, {
                attributes: true,
                attributeFilter: ['attr-8ifv7'],
              });
            }
            _cm?.registerObserver?.(this.mo);
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
          if (!metaDataElm) return;
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          this.checkResize = Date.now() + 300;
          metaDataElm.classList.add('tyt-metadata-hover');
        },
        mouseLeaveFn(evt) {
          const target = evt ? evt.target : null;
          if (!(target instanceof HTMLElement_)) return;
          const metaDataElm = target.closest('ytd-watch-metadata');
          if (!metaDataElm) return;
          metaDataElm.classList.remove('tyt-metadata-hover-resized');
          metaDataElm.classList.remove('tyt-metadata-hover');
        },
        moFn(lockId) {
          if (lockGet.fullChannelNameOnHoverAttrAsyncLock !== lockId) return;

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
          if (this.moSubId && _mc?.unwatch) _mc.unwatch(this.moSubId);
          this.moSubId = 'main::fullChannelNameOnHover';
          if (_mc?.watchTarget) {
            _mc.watchTarget(this.moSubId, uploadInfo, this.moCallback, {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['hidden', 'attr-3wb0k'],
            });
          } else {
            this.mo = new MutationObserver(this.moCallback);
            this.mo.observe(uploadInfo, {
              attributes: true,
              attributeFilter: ['hidden', 'attr-3wb0k'],
            });
            _cm?.registerObserver?.(this.mo);
          }
          uploadInfo.incAttribute111('attr-3wb0k');
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

    const __attachedSymbol__ = Symbol();

    const makeInitAttached = tag => {
      const inPageRearrange_ = inPageRearrange;
      inPageRearrange = false;
      for (const elm of document.querySelectorAll(`${tag}`)) {
        const cnt = insp(elm) || 0;
        if (typeof cnt.attached498 === 'function' && !elm[__attachedSymbol__])
          Promise.resolve(elm).then(eventMap[`${tag}::attached`]).catch(_ll.warn);
      }
      inPageRearrange = inPageRearrange_;
    };

    /**
     * Resolve the live chat frame element. Retries a couple of times
     * (waiting one frame between attempts) so the call works during
     * the brief window when the chat frame is still being mounted.
     * @returns {Promise<Element|null>} The chat frame, or `null` if it
     *   never mounts within the retry budget.
     */
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

    /**
     * Return the `<noscript ns-template>` element under the watch
     * flexy host, creating it on demand if it does not exist. The
     * element is used as a side-channel container for short-lived
     * markup that should not be visible to the user.
     * @returns {Element} The existing or newly created `<noscript>`.
     */
    const nsTemplateObtain = () => {
      let nsTemplate = document.querySelector('ytd-watch-flexy noscript[ns-template]');
      if (!nsTemplate) {
        nsTemplate = document.createElement('noscript');
        nsTemplate.setAttribute('ns-template', '');
        document.querySelector('ytd-watch-flexy').appendChild(nsTemplate);
      }
      return nsTemplate;
    };

    /**
     * Determine whether `elm` is a live Element instance that matches
     * the `selector` and is still connected to the document.
     * @param {*} elm Candidate value (Element, Node, etc.).
     * @param {string} selector CSS selector to test membership against.
     * @returns {boolean} `true` if `elm` is a connected, matching Element.
     */
    const isPageDOM = (elm, selector) => {
      if (!(elm && elm instanceof Element && elm.nodeName)) return false;
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

    let headerMutationObserver = null;
    /** @type {string | null} */
    let headerMutationSubId = null;
    let headerMutationTmpNode = null;
    /** @type {string | null} */
    let inlineExpanderSubId = null;
    /** @type {string | null} */
    let aoFlexySubId = null;
    /** @type {string | null} */
    let moEgmPanelReadySubId = null;
    let _moChangeReflectionCounter = 0;
    let _monitorDataChangedCounter = 0;

    const eventMap = {
      ceHack: () => {
        mLoaded.flag |= 2;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());

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

      fixForTabDisplay: isResize => {
        // isResize is true if the layout is resized (not due to tab switching)
        // youtube components shall handle the resize issue. can skip some checkings.

        bFixForResizedTabLater = false;
        for (const element of document.querySelectorAll('[io-intersected]')) {
          const cnt = insp(element);
          if (element instanceof HTMLElement_ && typeof cnt.calculateCanCollapse === 'function') {
            try {
              cnt.calculateCanCollapse(true);
            } catch (_e) {
              _ll.warn('calculateCanCollapse failed', _e);
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
              } catch (_e) {
                _ll.warn('notifyResize failed', _e);
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
                } catch (_e) {
                  _ll.warn('notifyResize failed', _e);
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

        if (
          !cProto.isTwoColumnsChanged498_ &&
          typeof cProto.isTwoColumnsChanged_ === 'function' &&
          cProto.isTwoColumnsChanged_.length === 2
        ) {
          cProto.isTwoColumnsChanged498_ = cProto.isTwoColumnsChanged_;
          cProto.isTwoColumnsChanged_ = function (arg1, arg2, ...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.isTwoColumnsChanged498_ !== 'function') return;
              const r = this.isTwoColumnsChanged498_(arg1, arg2, ...args);
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.defaultTwoColumnLayoutChanged498 &&
          typeof cProto.defaultTwoColumnLayoutChanged === 'function' &&
          cProto.defaultTwoColumnLayoutChanged.length === 0
        ) {
          cProto.defaultTwoColumnLayoutChanged498 = cProto.defaultTwoColumnLayoutChanged;
          cProto.defaultTwoColumnLayoutChanged = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.defaultTwoColumnLayoutChanged498 !== 'function') return;
              const r = this.defaultTwoColumnLayoutChanged498(...args);
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.updatePlayerLocation498 &&
          typeof cProto.updatePlayerLocation === 'function' &&
          cProto.updatePlayerLocation.length === 0
        ) {
          cProto.updatePlayerLocation498 = cProto.updatePlayerLocation;
          cProto.updatePlayerLocation = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.updatePlayerLocation498 !== 'function') return;
              const r = this.updatePlayerLocation498(...args);
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.updateCinematicsLocation498 &&
          typeof cProto.updateCinematicsLocation === 'function' &&
          cProto.updateCinematicsLocation.length === 0
        ) {
          cProto.updateCinematicsLocation498 = cProto.updateCinematicsLocation;
          cProto.updateCinematicsLocation = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.updateCinematicsLocation498 !== 'function') return;
              const r = this.updateCinematicsLocation498(...args);
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.updatePanelsLocation498 &&
          typeof cProto.updatePanelsLocation === 'function' &&
          cProto.updatePanelsLocation.length === 0
        ) {
          cProto.updatePanelsLocation498 = cProto.updatePanelsLocation;
          cProto.updatePanelsLocation = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.updatePanelsLocation498 !== 'function') return;
              const r = this.updatePanelsLocation498(...args);
              return r;
            });
            return r;
          };
        }
        if (
          !cProto.swatcherooUpdatePanelsLocation498 &&
          typeof cProto.swatcherooUpdatePanelsLocation === 'function' &&
          cProto.swatcherooUpdatePanelsLocation.length === 6
        ) {
          cProto.swatcherooUpdatePanelsLocation498 = cProto.swatcherooUpdatePanelsLocation;
          cProto.swatcherooUpdatePanelsLocation = function (
            arg1,
            arg2,
            arg3,
            arg4,
            arg5,
            arg6,
            ...args
          ) {
            const r = secondaryInnerFn(() => {
              if (typeof this.swatcherooUpdatePanelsLocation498 !== 'function') return;
              const r = this.swatcherooUpdatePanelsLocation498(
                arg1,
                arg2,
                arg3,
                arg4,
                arg5,
                arg6,
                ...args
              );
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.updateErrorScreenLocation498 &&
          typeof cProto.updateErrorScreenLocation === 'function' &&
          cProto.updateErrorScreenLocation.length === 0
        ) {
          cProto.updateErrorScreenLocation498 = cProto.updateErrorScreenLocation;
          cProto.updateErrorScreenLocation = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.updateErrorScreenLocation498 !== 'function') return;
              const r = this.updateErrorScreenLocation498(...args);
              return r;
            });
            return r;
          };
        }

        if (
          !cProto.updateFullBleedElementLocations498 &&
          typeof cProto.updateFullBleedElementLocations === 'function' &&
          cProto.updateFullBleedElementLocations.length === 0
        ) {
          cProto.updateFullBleedElementLocations498 = cProto.updateFullBleedElementLocations;
          cProto.updateFullBleedElementLocations = function (...args) {
            const r = secondaryInnerFn(() => {
              if (typeof this.updateFullBleedElementLocations498 !== 'function') return;
              const r = this.updateFullBleedElementLocations498(...args);
              return r;
            });
            return r;
          };
        }
      },

      'ytd-watch-next-secondary-results-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-next-secondary-results-renderer::detached'])
                .catch(_ll.warn);
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-next-secondary-results-renderer');
      },

      'ytd-watch-next-secondary-results-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;
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

      'ytd-watch-next-secondary-results-renderer::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        if (hostElement.hasAttribute000('tyt-videos-list')) {
          elements.related = null;
          hostElement.removeAttribute000('tyt-videos-list');
        }
        _ll.info('ytd-watch-next-secondary-results-renderer::detached', hostElement);
      },

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
      'ytd-comments::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::attached'])
                .catch(_ll.warn);
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments::detached'])
                .catch(_ll.warn);
            // Promise.resolve(this.hostElement).then(eventMap['ytd-comments::dataChanged_']).catch(_ll.warn);
            return this.detached498();
          };
        }

        // Define the data-changed handler up front so it's always available
        // regardless of which observation mechanism we use below.
        cProto._dataChanged498 = function () {
          Promise.resolve(this.hostElement)
            .then(eventMap['ytd-comments::_dataChanged498'])
            .catch(_ll.warn);
        };

        // Wire the handler into YouTube's data-change notification pipeline.
        // YouTube has been deprecating the Polymer _createPropertyObserver API,
        // so we check for its existence first and fall back to the newer
        // lifecycle hooks (dataChanged_ / dataChanged).
        if (typeof cProto._createPropertyObserver === 'function') {
          cProto._createPropertyObserver('data', '_dataChanged498', undefined);
        } else if (typeof cProto.dataChanged_ === 'function') {
          // Polymer 1.x / hybrid lifecycle hook
          cProto._dataChangedBackup = cProto.dataChanged_;
          cProto.dataChanged_ = function () {
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments::_dataChanged498'])
              .catch(_ll.warn);
            return this._dataChangedBackup();
          };
        } else if (typeof cProto.dataChanged === 'function') {
          // LitElement lifecycle hook
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
          // ytdFlexyElm.setAttribute111('tyt-comment-disabled', '')
        } else {
          // ytdFlexyElm.removeAttribute000('tyt-comment-disabled')
          hostElement.removeAttribute000('tyt-comments-data-status');
        }
        Promise.resolve(hostElement).then(eventMap.settingCommentsVideoId).catch(_ll.warn);
      },

      'ytd-comments::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;
        if (hostElement?.id !== 'comments') return;
        elements.comments = hostElement;
        _ll.info('ytd-comments::attached');
        Promise.resolve(hostElement).then(eventMap.settingCommentsVideoId).catch(_ll.warn);

        if (aoCommentSubId && _mc?.unwatch) _mc.unwatch(aoCommentSubId);
        aoCommentSubId = 'main::aoComment';
        if (_mc?.watchTarget) {
          _mc.watchTarget(aoCommentSubId, hostElement, onAoCommentMutation, {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['hidden', 'tyt-comments-video-id', 'tyt-comments-data-status'],
          });
        } else {
          const aoComment = new MutationObserver(onAoCommentMutation);
          aoComment.observe(hostElement, { attributes: true });
          _cm?.registerObserver?.(aoComment);
        }
        hostElement.setAttribute111('tyt-comments-area', '');

        const lockId = lockSet.rightTabReadyLock02;
        await rightTabsProvidedPromise.then();
        if (lockGet.rightTabReadyLock02 !== lockId) return;

        if (elements.comments !== hostElement) return;
        if (hostElement.isConnected === false) return;

        if (hostElement && !hostElement.closest('#right-tabs')) {
          document.querySelector('#tab-comments').assignChildren111(null, hostElement, null);
        } else {
          const shouldTabVisible =
            elements.comments?.closest('#tab-comments') && !elements.comments.closest('[hidden]');

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.toggle('tab-btn-hidden', !shouldTabVisible);

          //   document.querySelector('#tab-comments').classList.remove('tab-content-hidden')
          //   document.querySelector('[tyt-tab-content="#tab-comments"]').classList.remove('tab-btn-hidden')

          Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
            .then(removeKeepCommentsScroller)
            .catch(_ll.warn);
        }
      },
      'ytd-comments::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;

        if (hostElement.hasAttribute000('tyt-comments-area')) {
          // foComments.disconnect();
          // foComments.takeRecords();
          hostElement.removeAttribute000('tyt-comments-area');
          // document.querySelector('#tab-comments').classList.add('tab-content-hidden')
          // document.querySelector('[tyt-tab-content="#tab-comments"]').classList.add('tab-btn-hidden')

          if (aoCommentSubId && _mc?.unwatch) {
            _mc.unwatch(aoCommentSubId);
            aoCommentSubId = null;
          }
          elements.comments = null;

          document
            .querySelector('[tyt-tab-content="#tab-comments"]')
            .classList.add('tab-btn-hidden');

          Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
            .then(removeKeepCommentsScroller)
            .catch(_ll.warn);
        }
      },

      'ytd-comments-header-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::attached'])
                .catch(_ll.warn);
            Promise.resolve(this.hostElement)
              .then(eventMap['ytd-comments-header-renderer::dataChanged'])
              .catch(_ll.warn); // force dataChanged on attached
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-comments-header-renderer::detached'])
                .catch(_ll.warn);
            return this.detached498();
          };
        }

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

      'ytd-comments-header-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;
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

      'ytd-comments-header-renderer::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;

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
          if (_mc?.watchTarget) {
            if (headerMutationSubId) _mc.unwatch(headerMutationSubId);
            headerMutationSubId = 'main::commentsHeaderCounter';
            _mc.watchTarget(
              headerMutationSubId,
              hostElement.parentNode,
              eventMap['ytd-comments-header-renderer::deferredCounterUpdate'],
              { childList: true, attributes: false, subtree: false }
            );
          } else {
            if (!headerMutationObserver) {
              headerMutationObserver = new MutationObserver(
                eventMap['ytd-comments-header-renderer::deferredCounterUpdate']
              );
            }
            headerMutationObserver.disconnect();
            headerMutationObserver.observe(hostElement.parentNode, {
              subtree: false,
              childList: true,
            });
            _cm?.registerObserver?.(headerMutationObserver);
          }
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
          let ez = '';
          if (data.commentsCount?.runs && data.commentsCount.runs.length >= 1) {
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
          } else if (data.countText?.runs && data.countText.runs.length >= 1) {
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
            _ll.warn('no text for #tyt-cm-count');
          }
        }
      },

      'ytd-expander::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expander::detached'])
                .catch(_ll.warn);
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
              .catch(_ll.warn);
            return this.childrenChanged498();
          };
        }

        /*

        _ll.info('ytd-expander::defined 01');

        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback = connectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.connectedCallback)
        CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback = disconnectedCallbackY(CustomElementRegistry.prototype.get.call(customElements, 'ytd-expander').prototype.disconnectedCallback)

        _ll.info('ytd-expander::defined 02');

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
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-expandable-video-description-body-renderer::detached'])
                .catch(_ll.warn);
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
          _ll.info(128384, elements.infoExpander);

          infoExpanderElementProvidedPromise.resolve();
          hostElement.setAttribute111('tyt-main-info', '');
          if (plugin.autoExpandInfoDesc.toUse) {
            plugin.autoExpandInfoDesc.onMainInfoSet(hostElement);
          }

          const lockId = lockSet.rightTabReadyLock03;
          await rightTabsProvidedPromise.then();
          if (lockGet.rightTabReadyLock03 !== lockId) return;

          if (elements.infoExpander !== hostElement) return;
          if (hostElement.isConnected === false) return;
          _ll.info(7932, 'infoExpander');

          elements.infoExpander.classList.add('tyt-main-info'); // add a classname for it

          const infoExpander = elements.infoExpander;

          const inlineExpanderElm = infoExpander.querySelector('ytd-text-inline-expander');
          if (inlineExpanderElm) {
            /**
             * Mutation handler for the inline expander element. Persists
             * the auto-expand state into sessionStorage (used by the next
             * navigation) and re-applies the content fixup so the tab
             * stays in sync with the live watch page state.
             * @returns {void}
             */
            const onInlineExpanderMutation = () => {
              const p = document.querySelector('#tab-info ytd-text-inline-expander');
              sessionStorage.__$$tmp_UseAutoExpandInfoDesc$$__ = p?.hasAttribute('is-expanded')
                ? '1'
                : '';
              if (p) fixInlineExpanderContent();
            };
            if (_mc?.watchTarget) {
              if (inlineExpanderSubId) _mc.unwatch(inlineExpanderSubId);
              inlineExpanderSubId = 'main::inlineExpander';
              _mc.watchTarget(inlineExpanderSubId, inlineExpanderElm, onInlineExpanderMutation, {
                attributes: true,
                childList: false,
                subtree: true,
                attributeFilter: ['is-expanded', 'attr-6v8qu', 'hidden'],
              });
            } else {
              const mo = new MutationObserver(onInlineExpanderMutation);
              mo.observe(inlineExpanderElm, {
                attributes: true,
                attributeFilter: ['is-expanded', 'attr-6v8qu', 'hidden'],
                subtree: true,
              });
              _cm?.registerObserver?.(mo);
            }
            inlineExpanderElm.incAttribute111('attr-6v8qu');
            const cnt = insp(inlineExpanderElm);

            if (cnt) fixInlineExpanderDisplay(cnt);
          }

          if (infoExpander && !infoExpander.closest('#right-tabs')) {
            document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
          } else {
            if (document.querySelector('[tyt-tab-content="#tab-info"]')) {
              const shouldTabVisible = elements.infoExpander?.closest('#tab-info');
              document
                .querySelector('[tyt-tab-content="#tab-info"]')
                .classList.toggle('tab-btn-hidden', !shouldTabVisible);
            }
          }

          Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn); // required when the page is switched from channel to watch

          // return;
        }

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;

        if (
          !(isPageDOM(hostElement, '#tab-info [tyt-main-info]') || hostElement.closest('#tab-info'))
        ) {
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

        if (hostElement.hasAttribute000('tyt-main-info')) {
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      'ytd-expander::attached': async hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;

        if (
          hostElement instanceof HTMLElement_ &&
          hostElement.matches('[tyt-comments-area] #contents ytd-expander#expander') &&
          !hostElement.matches('[hidden] ytd-expander#expander')
        ) {
          hostElement.setAttribute111('tyt-content-comment-entry', '');
          ioComment.observe(hostElement);
        }

        // --------------

        //   //  && !hostElement.matches('#right-tabs ytd-expander#expander, [hidden] ytd-expander#expander')

        //   const bodyRenderer = hostElement.closest('ytd-expandable-video-description-body-renderer');
        //   let bodyRendererNew = document.querySelector('ytd-expandable-video-description-body-renderer[tyt-info-renderer]');
        //   if (!bodyRendererNew) {
        //     nsTemplateObtain().appendChild(bodyRendererNew);
        //   }
        //   // document.querySelector('#tab-info').assignChildren111(null, bodyRendererNew, null);

        //   insp(bodyRendererNew).data = insp(bodyRenderer).data;
        //   // if((bodyRendererNew.hasAttribute('hidden')?1:0)^(bodyRenderer.hasAttribute('hidden')?1:0)){
        //   //   if(bodyRenderer.hasAttribute('hidden')) bodyRendererNew.setAttribute('hidden', '');
        // --------------
      },

      'ytd-expander::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;

        if (hostElement.hasAttribute000('tyt-content-comment-entry')) {
          ioComment.unobserve(hostElement);
          hostElement.removeAttribute000('tyt-content-comment-entry');
        } else if (hostElement.hasAttribute000('tyt-main-info')) {
          elements.infoExpander = null;
          hostElement.removeAttribute000('tyt-main-info');
        }
      },

      'ytd-live-chat-frame::defined': cProto => {
        let _lastDomAction = 0;

        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            _lastDomAction = Date.now();

            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            _lastDomAction = Date.now();

            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-live-chat-frame::detached'])
                .catch(_ll.warn);
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
            await this.__urlChangedAsyncT688__;
            const t = (ath = (ath & 1073741823) + 1);
            const chatframe = this.chatframe || (this.$ || 0).chatframe || 0;
            if (chatframe instanceof HTMLIFrameElement) {
              if (chatframe.contentDocument === null) {
                await Promise.resolve('#').catch(_ll.warn);
                if (t !== ath) return;
              }
              await new Promise(resolve => setTimeout_(resolve, 1)).catch(_ll.warn); // neccessary for Brave
              if (t !== ath) return;
              const isBlankPage = !this.data || this.collapsed;
              const p1 = new Promise(resolve => setTimeout_(resolve, 706)).catch(_ll.warn);
              let ioObserver = null;
              const p2 = new Promise(resolve => {
                ioObserver = new IntersectionObserver((entries, observer) => {
                  for (const entry of entries) {
                    const rect = entry.boundingClientRect || 0;
                    if (isBlankPage || (rect.width > 0 && rect.height > 0)) {
                      observer.disconnect();
                      ioObserver = null;
                      resolve('#');
                      break;
                    }
                  }
                });
                ioObserver.observe(chatframe);
              }).catch(_ll.warn);
              await Promise.race([p1, p2]);
              if (ioObserver) {
                ioObserver.disconnect();
                ioObserver = null;
              }
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

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;
        if (hostElement?.id !== 'chat') return;
        _ll.info('ytd-live-chat-frame::attached');

        const lockId = lockSet.ytdLiveAttachedLock;
        const chatElem = await getGeneralChatElement();
        if (lockGet.ytdLiveAttachedLock !== lockId) return;

        if (chatElem === hostElement) {
          elements.chat = chatElem;
          if (aoChatSubId && _mc?.unwatch) _mc.unwatch(aoChatSubId);
          aoChatSubId = 'main::aoChat';
          if (_mc?.watchTarget) {
            _mc.watchTarget(aoChatSubId, chatElem, onAoChatMutation, {
              attributes: true,
              childList: false,
              subtree: false,
            });
          } else {
            const aoChat = new MutationObserver(onAoChatMutation);
            aoChat.observe(chatElem, { attributes: true });
            _cm?.registerObserver?.(aoChat);
          }
        }
      },

      'ytd-live-chat-frame::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
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

      'ytd-engagement-panel-section-list-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-engagement-panel-section-list-renderer::detached'])
                .catch(_ll.warn);
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
          Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
          if (aoEgmPanelsSubId && _mc?.unwatch) _mc.unwatch(aoEgmPanelsSubId);
          aoEgmPanelsSubId = 'main::aoEgmPanels';
          if (_mc?.watchTarget) {
            _mc.watchTarget(aoEgmPanelsSubId, hostElement, onAoEgmPanelsMutation, {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['visibility', 'hidden'],
            });
          } else {
            const aoEgmPanels = new MutationObserver(onAoEgmPanelsMutation);
            aoEgmPanels.observe(hostElement, {
              attributes: true,
              attributeFilter: ['visibility', 'hidden'],
            });
            _cm?.registerObserver?.(aoEgmPanels);
          }
        }
      },

      'ytd-engagement-panel-section-list-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;

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
          } catch {
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
          if (moEgmPanelReadySubId && _mc?.unwatch) _mc.unwatch(moEgmPanelReadySubId);
          moEgmPanelReadySubId = 'main::moEgmPanelReady';
          if (_mc?.watchTarget) {
            _mc.watchTarget(moEgmPanelReadySubId, hostElement, onMoEgmPanelReadyMutation, {
              attributes: true,
              childList: false,
              subtree: false,
              attributeFilter: ['visibility', 'target-id'],
            });
          } else {
            const moEgmPanelReady = new MutationObserver(onMoEgmPanelReadyMutation);
            moEgmPanelReady.observe(hostElement, {
              attributes: true,
              attributeFilter: ['visibility', 'target-id'],
            });
            _cm?.registerObserver?.(moEgmPanelReady);
          }
        }
      },

      'ytd-engagement-panel-section-list-renderer::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
        if (hostElement.hasAttribute000('tyt-egm-panel')) {
          hostElement.removeAttribute000('tyt-egm-panel');
          Promise.resolve(lockSet.updateEgmPanelsLock).then(updateEgmPanels).catch(_ll.warn);
        } else if (hostElement.hasAttribute000('tyt-egm-panel-jclmd')) {
          hostElement.removeAttribute000('tyt-egm-panel-jclmd');
          moEgmPanelReadyClearFn();
        }
      },

      'ytd-watch-metadata::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-watch-metadata::detached'])
                .catch(_ll.warn);
            return this.detached498();
          };
        }

        makeInitAttached('ytd-watch-metadata');
      },

      'ytd-watch-metadata::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;

        if (plugin.fullChannelNameOnHover.activated)
          plugin.fullChannelNameOnHover.onNavigateFinish();
      },

      'ytd-watch-metadata::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
      },

      'ytd-playlist-panel-renderer::defined': cProto => {
        if (!cProto.attached498 && typeof cProto.attached === 'function') {
          cProto.attached498 = cProto.attached;
          cProto.attached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::attached'])
                .catch(_ll.warn);
            return this.attached498();
          };
        }
        if (!cProto.detached498 && typeof cProto.detached === 'function') {
          cProto.detached498 = cProto.detached;
          cProto.detached = function () {
            if (!inPageRearrange)
              Promise.resolve(this.hostElement)
                .then(eventMap['ytd-playlist-panel-renderer::detached'])
                .catch(_ll.warn);
            return this.detached498();
          };
        }

        makeInitAttached('ytd-playlist-panel-renderer');
      },

      'ytd-playlist-panel-renderer::attached': hostElement => {
        if (invalidFlexyParent(hostElement)) return;

        if (hostElement instanceof Element) hostElement[__attachedSymbol__] = true;
        if (
          !(hostElement instanceof HTMLElement_ && hostElement.classList.length > 0) ||
          hostElement.closest('noscript')
        )
          return;
        if (hostElement.isConnected !== true) return;

        elements.playlist = hostElement;

        if (aoPlayListSubId && _mc?.unwatch) _mc.unwatch(aoPlayListSubId);
        aoPlayListSubId = 'main::aoPlayList';
        if (_mc?.watchTarget) {
          _mc.watchTarget(aoPlayListSubId, hostElement, onAoPlayListMutation, {
            attributes: true,
            childList: false,
            subtree: false,
            attributeFilter: ['hidden', 'collapsed', 'attr-1y6nu'],
          });
        } else {
          const aoPlayList = new MutationObserver(onAoPlayListMutation);
          aoPlayList.observe(hostElement, {
            attributes: true,
            attributeFilter: ['hidden', 'collapsed', 'attr-1y6nu'],
          });
          _cm?.registerObserver?.(aoPlayList);
        }
        hostElement.incAttribute111('attr-1y6nu');
      },

      'ytd-playlist-panel-renderer::detached': hostElement => {
        if (!(hostElement instanceof HTMLElement_) || hostElement.closest('noscript')) return;
        if (hostElement.isConnected !== false) return;
      },

      _yt_playerProvided: () => {
        mLoaded.flag |= 4;
        document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());
      },
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

      refreshSecondaryInner: lockId => {
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        if (lockGet.refreshSecondaryInnerLock !== lockId) return;
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
          ytdFlexyElm?.matches(
            'ytd-watch-flexy[theater][full-bleed-player]:not([full-bleed-no-max-width-columns])'
          )
        ) {
          // ytdFlexyElm.fullBleedNoMaxWidthColumns = true;
          ytdFlexyElm.setAttribute111('full-bleed-no-max-width-columns', '');
        }

        const related = elements.related;
        if (related?.isConnected && !related.closest('#right-tabs #tab-videos')) {
          document.querySelector('#tab-videos').assignChildren111(null, related, null);
        }
        const infoExpander = elements.infoExpander;
        if (infoExpander?.isConnected && !infoExpander.closest('#right-tabs #tab-info')) {
          document.querySelector('#tab-info').assignChildren111(null, infoExpander, null);
        } else {
          //   Promise.resolve(lockSet['infoFixLock']).then(infoFix).catch(_ll.warn);
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
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        const ytdAppElm = document.querySelector(
          'ytd-page-manager#page-manager.style-scope.ytd-app'
        );
        const ytdAppCnt = insp(ytdAppElm);
        pageType = ytdAppCnt ? (ytdAppCnt.data || 0).page : null;

        if (!document.querySelector('ytd-watch-flexy #player')) return;

        const rightTabsMissing = isRightTabsInserted && !document.querySelector('#right-tabs');
        if (rightTabsMissing) {
          // The tabview DOM was torn down during a previous navigation (e.g.
          // watch → channel → refresh → back to watch). Reset the one-shot
          // promises so the insertion chain can fire again for this watch page.
          resetTabviewInsertPromises();
          // If the related-element animation already fired and elements.related
          // is populated, unblock the videos promise immediately so the
          // insertion chain resolves as soon as navigateFinishedPromise does.
          if (elements.related) {
            videosElementProvidedPromise.resolve();
          }
        }

        const flexyArr = [...document.querySelectorAll('ytd-watch-flexy')].filter(
          e => !e.closest('[hidden]') && e.querySelector('#player')
        );
        if (flexyArr.length === 1) {
          // const lockId = lockSet['yt-navigate-finish-videos'];
          elements.flexy = flexyArr[0];
          if (isRightTabsInserted) {
            // Reset stale tab state from the previous watch page so
            // tabsStatusCorrection computes the diff from a clean baseline.
            tabAStatus = 0;
            lastTab = '';
            lastPanel = '';
            // Re-bind the flexy attribute observer to the new element.
            // YouTube may replace ytd-watch-flexy across SPA navigations,
            // so the observer set up in onceInsertRightTabs could be
            // watching a detached element.
            const ytdFlexyElmRefresh = elements.flexy;
            if (ytdFlexyElmRefresh) {
              if (aoFlexySubId && _mc?.unwatch) _mc.unwatch(aoFlexySubId);
              aoFlexySubId = 'main::aoFlexy';
              if (_mc?.watchTarget) {
                _mc.watchTarget(aoFlexySubId, ytdFlexyElmRefresh, eventMap.aoFlexyFn, {
                  attributes: true,
                  childList: false,
                  subtree: false,
                });
              } else {
                const aoFlexy = new MutationObserver(eventMap.aoFlexyFn);
                aoFlexy.observe(ytdFlexyElmRefresh, { attributes: true });
              }
            }
            Promise.resolve(lockSet.refreshSecondaryInnerLock)
              .then(eventMap.refreshSecondaryInner)
              .catch(_ll.warn);
            Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
              .then(removeKeepCommentsScroller)
              .catch(_ll.warn);
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
          if (infoExpander?.closest('#right-tabs')) {
            Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
          }
          Promise.resolve(lockSet.layoutFixLock).then(layoutFix).catch(_ll.warn);
          if (plugin.fullChannelNameOnHover.activated)
            plugin.fullChannelNameOnHover.onNavigateFinish();
        }
      },

      onceInsertRightTabs: () => {
        if (!document.documentElement.hasAttribute('tabview-loaded')) return;
        // if(lockId !== lockGet['yt-navigate-finish-videos']) return;
        const related = elements.related;
        let rightTabs = document.querySelector('#right-tabs');
        if (!rightTabs && related) {
          setLangForPage();
          // HTML insertion hardening: parse the tab markup through a
          // detached <template> element rather than into the live DOM.
          // The template's innerHTML assignment goes through the
          // canonical createHTML() wrapper (which delegates to
          // safe-dom's createTrustedHTML); the parsed result lives
          // in `docTmp.content` and is read out as a fragment, so the
          // markup is never rendered un-trusted. The default Trusted
          // Types policy installed at boot keeps this assignment
          // permissive on hosts that enforce TT.
          // Create fragment using safe DOM directly
          let docTmp = window.YouTubeSafeDOM
            ? window.YouTubeSafeDOM.createFragment(getTabsHTML())
            : null;
          if (!docTmp) {
            // fallback if safeDOM is missing
            docTmp = document.createElement('div');
            docTmp['inner' + 'HTML'] = createHTML(getTabsHTML());
          }
          const newElm = docTmp.firstElementChild;
          if (newElm !== null) {
            inPageRearrange = true;
            related.parentNode.insertBefore000(newElm, related);
            inPageRearrange = false;
          }
          rightTabs = newElm;
          if (rightTabs) {
            rightTabs
              .querySelector('[tyt-tab-content="#tab-comments"]')
              .classList.add('tab-btn-hidden');
          }

          const secondaryWrapper = document.createElement('secondary-wrapper');
          secondaryWrapper.classList.add('tabview-secondary-wrapper');
          secondaryWrapper.id = 'secondary-inner-wrapper';
          const secondaryInner = document.querySelector(
            '#secondary-inner.style-scope.ytd-watch-flexy'
          );

          if (secondaryInner) {
            inPageRearrange = true;
            secondaryWrapper.replaceChildren000(...secondaryInner.childNodes);
            secondaryInner.insertBefore000(secondaryWrapper, secondaryInner.firstChild);
            inPageRearrange = false;
          }

          if (rightTabs) {
            rightTabs
              .querySelector('#material-tabs')
              .addEventListener('click', eventMap['tabs-btn-click'], true);
          }

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
          _cm?.registerObserver?.(ioTabBtns);
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
          _cm?.registerObserver?.(roRightTabs);
          const ytdFlexyElm = elements.flexy;
          if (aoFlexySubId && _mc?.unwatch) _mc.unwatch(aoFlexySubId);
          aoFlexySubId = 'main::aoFlexy';
          if (_mc?.watchTarget) {
            _mc.watchTarget(aoFlexySubId, ytdFlexyElm, eventMap.aoFlexyFn, {
              attributes: true,
              childList: false,
              subtree: false,
            });
          } else {
            const aoFlexy = new MutationObserver(eventMap.aoFlexyFn);
            aoFlexy.observe(ytdFlexyElm, { attributes: true });
            _cm?.registerObserver?.(aoFlexy);
          }
          // Promise.resolve(lockSet['tabsStatusCorrectionLock']).then(eventMap['tabsStatusCorrection']).catch(_ll.warn);

          Promise.resolve(lockSet.fixInitialTabStateLock)
            .then(eventMap.fixInitialTabStateFn)
            .catch(_ll.warn);

          ytdFlexyElm.incAttribute111('attr-7qlsy'); // tabsStatusCorrectionLock and video-id
        }
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
              behavior.invalidate(!1);
            }
          }
        }
      },

      /**
       * Tab-view state correction function. Called after every
       * `ytd-watch-flexy` attribute change to reconcile the expected
       * tab layout (theater, chat, playlist, etc.) with the live DOM.
       *
       * The function compares the previous (`p`) and current (`q`)
       * status bitmask and dispatches the minimal DOM actions needed
       * to keep the tabview consistent.
       *
       * Bit flag constants are defined in `FLAG` (see top of
       * `executionScript`).
       * @param {string} lockId
       * @returns {void}
       */
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This legacy function manages complex tabview state corrections based on bitmask comparisons.
      tabsStatusCorrection: lockId => {
        if (lockId !== lockGet.tabsStatusCorrectionLock) return;
        const ytdFlexyElm = elements.flexy;
        if (!ytdFlexyElm) return;
        const p = tabAStatus;
        const q = calculationFn(p, FLAG.ALL);
        let resetForPanelDisappeared = false;
        if (p !== q) {
          _ll.info(388, p, q);
          let actioned = false;
          let special = 0;
          if (plugin['external.ytlstm'].activated) {
            if (q & FLAG.FULLSCREEN) {
              // ignore fullscreen
            } else if (
              (p &
                (FLAG.THEATER |
                  FLAG.TAB_SELECTED |
                  FLAG.CHAT_COLLAPSED |
                  FLAG.CHAT_EXPANDED |
                  FLAG.TWO_COLUMNS |
                  FLAG.EXTERNAL_YTLSTM)) ===
                (FLAG.THEATER |
                  0 |
                  0 |
                  FLAG.CHAT_EXPANDED |
                  FLAG.TWO_COLUMNS |
                  FLAG.EXTERNAL_YTLSTM) &&
              (q &
                (FLAG.THEATER |
                  FLAG.TAB_SELECTED |
                  FLAG.CHAT_COLLAPSED |
                  FLAG.CHAT_EXPANDED |
                  FLAG.TWO_COLUMNS |
                  FLAG.EXTERNAL_YTLSTM)) ===
                (FLAG.THEATER |
                  0 |
                  FLAG.CHAT_COLLAPSED |
                  0 |
                  FLAG.TWO_COLUMNS |
                  FLAG.EXTERNAL_YTLSTM)
            ) {
              special = 3;
            } else if (
              (q & (FLAG.THEATER | FLAG.TWO_COLUMNS)) === (FLAG.THEATER | FLAG.TWO_COLUMNS) &&
              document.querySelector('[data-ytlstm-theater-mode]')
            ) {
              special = 1;
            } else if (
              (q & (FLAG.THEATER | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS)) ===
                (FLAG.THEATER | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS) &&
              document.querySelector('[is-two-columns_][theater][tyt-chat="+"]')
            ) {
              special = 2;
            }
          }
          if (special) {
            // special
          } else if ((p & FLAG.PLAYLIST) === 0 && (q & FLAG.PLAYLIST) === FLAG.PLAYLIST) {
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
            // 24 -> 16 = -8; 'd'
            lastPanel = lastTab || '';
            resetForPanelDisappeared = true;
          } else if (
            (p & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === FLAG.CHAT_EXPANDED &&
            (q & (FLAG.CHAT_COLLAPSED | FLAG.CHAT_EXPANDED)) === FLAG.CHAT_COLLAPSED &&
            lastPanel === 'chat'
          ) {
            // click close
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

          if ((q ^ FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED && bFixForResizedTabLater) {
            bFixForResizedTab = true;
          }

          if ((p & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS && (q & FLAG.TWO_COLUMNS) === 0) {
            Promise.resolve(lockSet.twoColumnChanged10Lock)
              .then(eventMap.twoColumnChanged10)
              .catch(_ll.warn);
          }

          if (
            ((p & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) ^
              ((q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) &&
            (q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED
          ) {
            bFixForResizedTab = true;
          }

          // p->q +2
          if (
            (p & FLAG.TAB_SELECTED) === 0 &&
            (q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED &&
            (p & FLAG.PLAYLIST) === FLAG.PLAYLIST &&
            (q & FLAG.PLAYLIST) === FLAG.PLAYLIST
          ) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          // p->q +8
          if (
            (p & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST) &&
            (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST) &&
            lastPanel === 'chat'
          ) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          if (
            (p & FLAG.ALL_STANDARD) ===
              (FLAG.THEATER | FLAG.TAB_SELECTED | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS) &&
            (q & FLAG.ALL_STANDARD) ===
              (0 | FLAG.TAB_SELECTED | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS)
          ) {
            // external.ytlstm case
            lastPanel = lastTab || '';
            ytBtnCollapseChat();
            actioned = true;
          }
          // p->q +128
          if (
            (p & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (FLAG.TAB_SELECTED | 0) &&
            (q & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (FLAG.TAB_SELECTED | FLAG.PLAYLIST) &&
            lastPanel === 'playlist'
          ) {
            switchToTab(null);
            actioned = true;
          }

          // p->q +128
          if (
            (p & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | 0) &&
            (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST) &&
            lastPanel === 'playlist'
          ) {
            lastPanel = lastTab || '';
            ytBtnCollapseChat();
            actioned = true;
          }

          // p->q +128
          if (
            (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
              (FLAG.THEATER | FLAG.TWO_COLUMNS) &&
            (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
              (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)
          ) {
            ytBtnCancelTheater();
            actioned = true;
          }

          // p->q +1
          if (
            (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
              (FLAG.TWO_COLUMNS | FLAG.PLAYLIST) &&
            (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)) ===
              (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.PLAYLIST)
          ) {
            lastPanel = lastTab || '';
            ytBtnClosePlaylist();
            actioned = true;
          }

          if ((q & FLAG.FULLSCREEN) === FLAG.FULLSCREEN) {
            actioned = false;
          } else if ((p & FLAG.FULLSCREEN) === FLAG.FULLSCREEN && (q & FLAG.FULLSCREEN) === 0) {
            // p->q -64

            if ((q & FLAG.ENGAGEMENT_PANEL) === FLAG.ENGAGEMENT_PANEL) {
              ytBtnCloseEngagementPanels();
            }

            if (
              (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) ===
              (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)
            ) {
              if (lastPanel === 'chat') {
                switchToTab(null);
                actioned = true;
              } else if (lastPanel) {
                ytBtnCollapseChat();
                actioned = true;
              }
            }
          } else if (
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
              (FLAG.THEATER | 0 | FLAG.CHAT_EXPANDED | FLAG.TWO_COLUMNS | 0)
          ) {
            // p->q +8
            ytBtnCancelTheater();
            actioned = true;
          } else if (
            (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL)) ===
              (0 | FLAG.TWO_COLUMNS | 0) &&
            (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL)) ===
              (0 | FLAG.TWO_COLUMNS | FLAG.ENGAGEMENT_PANEL) &&
            (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) > 0
          ) {
            // p->q +32
            if (q & FLAG.TAB_SELECTED) {
              switchToTab(null);
              actioned = true;
            }
            if (q & FLAG.CHAT_EXPANDED) {
              ytBtnCollapseChat();
              actioned = true;
            }
          } else if (
            (p & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED | FLAG.TAB_SELECTED)) ===
              (FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED) &&
            (q & (FLAG.THEATER | FLAG.TWO_COLUMNS | FLAG.CHAT_EXPANDED | FLAG.TAB_SELECTED)) ===
              FLAG.TWO_COLUMNS &&
            (q & FLAG.PLAYLIST) === 0
          ) {
            // p->q -8
            if (lastTab) {
              switchToTab(lastTab);
              actioned = true;
            }
          } else if ((p & FLAG.THEATER) === 0 && (q & FLAG.THEATER) === FLAG.THEATER) {
            // p->q +1
            if ((q & FLAG.ENGAGEMENT_PANEL) === FLAG.ENGAGEMENT_PANEL) {
              ytBtnCloseEngagementPanels();
            }
            if (
              (p & (FLAG.THEATER | FLAG.CHAT_EXPANDED)) === FLAG.CHAT_EXPANDED &&
              (q & (FLAG.THEATER | FLAG.CHAT_EXPANDED)) === (FLAG.THEATER | FLAG.CHAT_EXPANDED)
            ) {
              ytBtnCollapseChat();
            }
            switchToTab(null);
            actioned = true;
          } else if (
            (p & (FLAG.THEATER | FLAG.TAB_SELECTED)) === FLAG.THEATER &&
            (q & (FLAG.THEATER | FLAG.TAB_SELECTED)) === (FLAG.THEATER | FLAG.TAB_SELECTED)
          ) {
            // p->q +2
            ytBtnCancelTheater();
            actioned = true;
          } else if (
            (p & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) === FLAG.TAB_SELECTED &&
            (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) ===
              (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)
          ) {
            // p->q +8
            switchToTab(null);
            actioned = true;
          } else if (
            (p & (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL)) === (0 | FLAG.ENGAGEMENT_PANEL) &&
            (q & (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL)) ===
              (FLAG.CHAT_EXPANDED | FLAG.ENGAGEMENT_PANEL)
          ) {
            // p->q +8
            ytBtnCloseEngagementPanels();
            actioned = true;
          } else if (
            (p & (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL)) === (0 | FLAG.ENGAGEMENT_PANEL) &&
            (q & (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL)) ===
              (FLAG.TAB_SELECTED | FLAG.ENGAGEMENT_PANEL)
          ) {
            // p->q +2
            ytBtnCloseEngagementPanels();
            actioned = true;
          } else if (
            (p & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) === (0 | FLAG.CHAT_EXPANDED) &&
            (q & (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)) ===
              (FLAG.TAB_SELECTED | FLAG.CHAT_EXPANDED)
          ) {
            // p->q +2
            ytBtnCollapseChat();
            actioned = true;
          } else if (
            (p & FLAG.THEATER) === FLAG.THEATER &&
            (q & (FLAG.THEATER | FLAG.ENGAGEMENT_PANEL)) === (0 | 0)
          ) {
            // p->q -1
            if (lastPanel === 'chat') {
              ytBtnExpandChat();
              actioned = true;
            } else if (lastPanel === lastTab && lastTab) {
              switchToTab(lastTab);
              actioned = true;
            }
          }

          if (!actioned && (q & FLAG.PLAYLIST) === FLAG.PLAYLIST) {
            lastPanel = 'playlist';
            if ((q & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED) {
              switchToTab(null);
              actioned = true;
            }
          }

          let shouldDoAutoFix = false;

          if (
            (p & FLAG.TAB_SELECTED) === FLAG.TAB_SELECTED &&
            (q & (FLAG.TAB_SELECTED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST)
          ) {
            // p->q -2
          } else if (
            (p & FLAG.CHAT_EXPANDED) === FLAG.CHAT_EXPANDED &&
            (q & (FLAG.CHAT_EXPANDED | FLAG.PLAYLIST)) === (0 | FLAG.PLAYLIST)
          ) {
            // p->q -8
          } else if (
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
            shouldDoAutoFix = true;
          } else if ((q & FLAG.ALL_STANDARD) === (FLAG.CHAT_COLLAPSED | FLAG.TWO_COLUMNS)) {
            shouldDoAutoFix = true;
          }

          if (shouldDoAutoFix) {
            _ll.info(388, 'd');
            if (lastPanel === 'chat') {
              _ll.info(388, 'd1c');
              ytBtnExpandChat();
              actioned = true;
            } else if (lastPanel === 'playlist') {
              _ll.info(388, 'd1p');
              ytBtnOpenPlaylist();
              actioned = true;
            } else if (lastTab) {
              _ll.info(388, 'd2t');
              switchToTab(lastTab);
              actioned = true;
            } else if (resetForPanelDisappeared) {
              // if lastTab is undefined
              _ll.info(388, 'd2d');
              Promise.resolve(lockSet.fixInitialTabStateLock)
                .then(eventMap.fixInitialTabStateFn)
                .catch(_ll.warn);
              actioned = true;
            }
          }

          if (bFixForResizedTab) {
            bFixForResizedTabLater = false;
            Promise.resolve(0).then(eventMap.fixForTabDisplay).catch(_ll.warn);
          }

          if (
            ((p & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS) ^
            ((q & FLAG.TWO_COLUMNS) === FLAG.TWO_COLUMNS)
          ) {
            Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
            Promise.resolve(lockSet.removeKeepCommentsScrollerLock)
              .then(removeKeepCommentsScroller)
              .catch(_ll.warn);
            Promise.resolve(lockSet.layoutFixLock).then(layoutFix).catch(_ll.warn);
          }
        }
      },

      updateOnVideoIdChanged: lockId => {
        if (lockId !== lockGet.updateOnVideoIdChangedLock) return;
        const videoId = tmpLastVideoId;
        if (!videoId) return;

        const bodyRenderer = elements.infoExpanderRendererBack;
        const bodyRendererNew = elements.infoExpanderRendererFront;

        if (bodyRendererNew && bodyRenderer) {
          insp(bodyRendererNew).data = insp(bodyRenderer).data;
          // if ((bodyRendererNew.hasAttribute('hidden') ? 1 : 0) ^ (bodyRenderer.hasAttribute('hidden') ? 1 : 0)) {
          //   else bodyRendererNew.removeAttribute('hidden');
          // }
        }

        Promise.resolve(lockSet.infoFixLock).then(infoFix).catch(_ll.warn);
      },

      fixInitialTabStateFn: async lockId => {
        if (lockGet.fixInitialTabStateLock !== lockId) return;

        const delayTime = fixInitialTabStateK > 0 ? 200 : 1;
        await delayPn(delayTime);
        if (lockGet.fixInitialTabStateLock !== lockId) return;

        const kTab = document.querySelector('[tyt-tab]');
        const qTab =
          !kTab || kTab.getAttribute('tyt-tab') === ''
            ? checkElementExist('ytd-watch-flexy[is-two-columns_]', '[hidden]')
            : null;
        if (checkElementExist('ytd-playlist-panel-renderer#playlist', '[hidden], [collapsed]')) {
          switchToTab(null);
        } else if (checkElementExist('ytd-live-chat-frame#chat', '[hidden], [collapsed]')) {
          switchToTab(null);
          if (checkElementExist('ytd-watch-flexy[theater]', '[hidden]')) {
            ytBtnCollapseChat();
          }
        } else if (qTab) {
          const hasTheater = qTab.hasAttribute('theater');
          if (!hasTheater) {
            const btn0 = document.querySelector('.tab-btn-visible'); // or default button
            if (btn0) {
              switchToTab(btn0);
            } else {
              switchToTab(null);
            }
          } else {
            switchToTab(null);
          }
        }

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
      .then(eventMap.onceInsertRightTabs)
      .catch(_ll.warn);
    Promise.all([navigateFinishedPromise, infoExpanderElementProvidedPromise])
      .then(eventMap.onceInfoExpanderElementProvidedPromised)
      .catch(_ll.warn);

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

    const _retrieveCE = async nodeName => {
      try {
        isCustomElementsProvided || (await promiseForCustomYtElementsReady);
        await customElements.whenDefined(nodeName);
      } catch (e) {
        _ll.warn(e);
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
        _ll.warn(e);
      }
    };

    const moOverallRes = {
      _yt_playerProvided: () => (window || 0)._yt_player || 0 || 0,
    };

    let promiseWaitNext = null;
    /**
     * Document-wide mutation handler. Drains the pending "wait next"
     * promise (so consumers waiting for any DOM change can resume) and
     * invokes the player-provided hook when the host's bootstrap
     * indicator is observed.
     * @returns {void}
     */
    const onMoOverallMutation = () => {
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
    };

    // Route the document-wide subtree / childList watcher through the
    // shared mutation coordinator. The coordinator's root observer is
    // already configured with subtree+childList, so this is a free
    // subscription with no new MutationObserver instance.
    if (_mc?.subscribeRoot) {
      _mc.subscribeRoot('main::moOverall', onMoOverallMutation, {
        childList: true,
        attributes: false,
        subtree: true,
      });
    } else {
      const moOverall = new MutationObserver(onMoOverallMutation);
      moOverall.observe(document, { subtree: true, childList: true });
      _cm?.registerObserver?.(moOverall);
    }

    const onMoEgmPanelReadyMutation = mutations => {
      for (const mutation of mutations) {
        const target = mutation.target;
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

    /**
     * Tear down the engagement-panel-ready watcher when no
     * `tyt-egm-panel-jclmd` placeholder remains in the DOM. Called
     * every time a panel is bound so the watcher is removed once it
     * has done its job.
     * @returns {void}
     */
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
    document.addEventListener('yt-navigate-finish', eventMap['yt-navigate-finish'], false);
    document.addEventListener(
      'animationstart',
      evt => {
        const f = eventMap[evt.animationName];
        if (typeof f === 'function') f(evt.target);
      },
      capturePassive
    );

    if (isTabviewEnabled()) {
      mLoaded.flag |= 1;
      document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());
    }

    promiseForCustomYtElementsReady.then(eventMap.ceHack).catch(_ll.warn);

    // i18n â†’ style bridge.
    //
    // This IIFE wires the canonical i18n module (window.YouTubePlusI18n)
    // into two runtime surfaces that cannot live in the static tabview
    // stylesheet:
    //   - updateTabLabels(): tab button label text (textContent, not style)
    //   - updateCSSVars(): two CSS custom properties on documentElement
    //     used by the right-rail stylesheet for the loading / fetching
    //     ::after placeholders.
    //
    // The CSS custom properties are intentionally set via
    // documentElement.style.setProperty(...) rather than routed through
    // the canonical design-system StyleManager because StyleManager owns
    // a keyed registry of static stylesheets; the values here are
    // i18n-driven runtime strings that must change when the user changes
    // language. setProperty is the right tool for runtime CSS custom
    // property updates and does not collide with the static stylesheet
    // owned by StyleManager.
    //
    // The IIFE is fire-and-forget: a thrown i18n failure is non-critical
    // (the FALLBACK labels keep the UI usable) and is intentionally
    // swallowed.
    (function applyI18n() {
      try {
        const i18n = window.YouTubePlusI18n;
        const FALLBACK = {
          info: 'Info',
          videos: 'Videos',
          playlist: 'Playlist',
        };
        /**
         * Refresh the localized labels on the rendered tab buttons.
         * Uses the active i18n translation when available and falls
         * back to a hardcoded English label when the i18n service is
         * not yet ready.
         * @returns {void}
         */
        const updateTabLabels = () => {
          for (const { id, key } of [
            { id: 'tab-btn1', key: 'info' },
            { id: 'tab-btn4', key: 'videos' },
            { id: 'tab-btn5', key: 'playlist' },
          ]) {
            const btn = document.getElementById(id);
            if (!btn) continue;
            const spans = btn.querySelectorAll('span');
            let span = null;
            for (const s of spans) {
              if (s.id !== 'tyt-cm-count') {
                span = s;
                break;
              }
            }
            if (!span) continue;
            if (i18n) {
              const text = i18n.t(key);
              if (text && text !== key) {
                span.textContent = text;
                continue;
              }
            }
            span.textContent = FALLBACK[key] || key;
          }
        };
        /**
         * Push translated "Loading" / "Fetching" strings into the CSS
         * custom properties consumed by the right-rail stylesheet. Only
         * writes when the translation differs from the key (so the CSS
         * default English placeholders stay as a safe fallback).
         * @returns {void}
         */
        const updateCSSVars = () => {
          if (!i18n) return;
          const loading = i18n.t('loading');
          if (loading && loading !== 'loading')
            document.documentElement.style.setProperty('--tabview-text-loading', loading);
          const fetching = i18n.t('fetching');
          if (fetching && fetching !== 'fetching')
            document.documentElement.style.setProperty('--tabview-text-fetching', fetching);
        };
        /**
         * Run one full tabview render pass: refresh CSS custom
         * properties, refresh localized tab labels, and recompute
         * the visibility state. Called from the live mount path and
         * from the tab-button / tab-content event handlers.
         * @returns {void}
         */
        const run = () => {
          updateCSSVars();
          updateTabLabels();
        };
        if (i18n && typeof i18n.onLanguageChange === 'function') {
          i18n.onLanguageChange(run);
        }
        if (i18n)
          window.addEventListener('youtube-plus-i18n-ready', run, {
            once: true,
          });
        rightTabsProvidedPromise.then(run);
      } catch (_e) {
        /* non-critical */
      }
    })();

    const restoreOriginalLayout = () => {
      document.documentElement.removeAttribute('tabview-loaded');

      const related = elements.related;
      const comments = elements.comments;
      const infoExpander = elements.infoExpander;

      const primaryInner = document.querySelector('#primary-inner.style-scope.ytd-watch-flexy');
      const secondaryInner = document.querySelector('#secondary-inner.style-scope.ytd-watch-flexy');

      if (secondaryInner) {
        const wrapper = secondaryInner.querySelector('#secondary-inner-wrapper');
        if (wrapper) {
          inPageRearrange = true;
          while (wrapper.firstChild) {
            secondaryInner.insertBefore(wrapper.firstChild, wrapper);
          }
          wrapper.remove();
          inPageRearrange = false;
        }
      }

      if (related && secondaryInner) {
        inPageRearrange = true;
        secondaryInner.appendChild(related);
        inPageRearrange = false;
      }

      if (infoExpander && primaryInner) {
        inPageRearrange = true;
        const commentsNode = primaryInner.querySelector('#comments');
        if (commentsNode) {
          primaryInner.insertBefore(infoExpander, commentsNode);
        } else {
          primaryInner.appendChild(infoExpander);
        }
        inPageRearrange = false;
      }

      if (comments && primaryInner) {
        inPageRearrange = true;
        primaryInner.appendChild(comments);
        inPageRearrange = false;
      }

      const rightTabs = document.querySelector('#right-tabs');
      if (rightTabs) {
        rightTabs.remove();
      }

      if (roRightTabs) {
        roRightTabs.disconnect();
      }

      if (aoFlexySubId && _mc?.unwatch) {
        _mc.unwatch(aoFlexySubId);
        aoFlexySubId = null;
      }

      // Reset stale tab state so re-enabling tabview starts clean.
      tabAStatus = 0;
      lastTab = '';
      lastPanel = '';
      isRightTabsInserted = false;
      // Reset the insertion promises so a later re-enable or navigation back
      // to a watch page can go through the full insertion chain again.
      resetTabviewInsertPromises();
    };

    window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
      try {
        const tabviewEnabled = e?.detail?.enableTabview !== false;
        const currentlyLoaded = document.documentElement.hasAttribute('tabview-loaded');
        if (tabviewEnabled && !currentlyLoaded) {
          mLoaded.flag |= 1;
          document.documentElement.setAttribute111('tabview-loaded', mLoaded.makeString());
          isRightTabsInserted = false;
          if (typeof eventMap?.onceInsertRightTabs === 'function') {
            eventMap.onceInsertRightTabs();
          }
          if (typeof eventMap?.onceInfoExpanderElementProvidedPromised === 'function') {
            eventMap.onceInfoExpanderElementProvidedPromised();
          }
          if (typeof eventMap?.['yt-navigate-finish'] === 'function') {
            eventMap['yt-navigate-finish']();
          }
        } else if (!tabviewEnabled && currentlyLoaded) {
          restoreOriginalLayout();
        }
      } catch (err) {
        _ll.warn('Error handling tabview toggle in settings update', err);
      }
    });

    _executionFinished = 1;
  } catch (e) {
    _ll.error('error 0xF491', e);
  }
};
const styles = {
  main: `
 @keyframes relatedElementProvided {
0%{background-position-x:3px}
100%{background-position-x:4px}
}
html[tabview-loaded="icp"] #related.ytd-watch-flexy{animation:relatedElementProvided 1ms linear 0s 1 normal forwards}
html[tabview-loaded="icp"] #right-tabs #related.ytd-watch-flexy,html[tabview-loaded="icp"] [hidden] #related.ytd-watch-flexy{animation:initial}
html[tabview-loaded="icp"] #right-tabs ytd-expander#expander,html[tabview-loaded="icp"] [hidden] ytd-expander#expander,html[tabview-loaded="icp"] ytd-comments ytd-expander#expander{animation:initial}
#secondary.ytd-watch-flexy{position:relative}
#secondary-inner.style-scope.ytd-watch-flexy{height:100%}
ytd-watch-flexy #secondary{--tyt-secondary-mt:var(--ytd-margin-6x);--tyt-secondary-mb:var(--ytd-margin-6x);--tyt-secondary-mr:var(--ytd-margin-6x)}
ytd-watch-flexy[reduced-top-margin] #secondary{--tyt-secondary-mt:var(--ytd-margin-3x);--tyt-secondary-mb:var(--ytd-margin-3x)}
secondary-wrapper{display:flex;flex-direction:column;flex-wrap:nowrap;box-sizing:border-box;padding:0;margin:0;border:0;height:100%;max-height:calc(100vh - var(--ytd-toolbar-height,56px));position:absolute;top:0;right:0;left:0;contain:size style;padding-top:var(--tyt-secondary-mt);padding-right:var(--tyt-secondary-mr);padding-bottom:var(--tyt-secondary-mb)}
#right-tabs{position:relative;display:flex;padding:0;margin:0;flex-grow:1;flex-direction:column}
[tyt-tab=""] #right-tabs{flex-grow:0}
[tyt-tab=""] #right-tabs .tab-content{border:0}
#right-tabs .tab-content{flex-grow:1}
ytd-watch-flexy[hide-default-text-inline-expander] #primary.style-scope.ytd-watch-flexy ytd-text-inline-expander{display:none}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden{--comment-pre-load-sizing:90px;visibility:collapse;z-index:-1;position:fixed!important;left:2px;top:2px;width:var(--comment-pre-load-sizing)!important;height:var(--comment-pre-load-sizing)!important;display:block!important;pointer-events:none!important;overflow:hidden;contain:strict;border:0;margin:0;padding:0}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections{display:block!important;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections > #contents{display:flex!important;flex-direction:row;gap:60px;overflow:hidden;height:var(--comment-pre-load-sizing);width:var(--comment-pre-load-sizing);contain:strict;border:0;margin:0;padding:0}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents{--comment-pre-load-display:none}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents > :only-of-type,ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents > :last-child{--comment-pre-load-display:block}
ytd-watch-flexy:not([keep-comments-scroller]) #tab-comments.tab-content-hidden ytd-comments#comments #contents > *{display:var(--comment-pre-load-display)!important}
#right-tabs #material-tabs{position:relative;display:flex;padding:0;border:1px solid var(--ytd-searchbox-legacy-border-color);overflow:hidden}
[tyt-tab] #right-tabs #material-tabs{border-radius:var(--tyt-rounded-a1) var(--tyt-rounded-a1) var(--tyt-rounded-a1) var(--tyt-rounded-a1)}
[tyt-tab^="#"] #right-tabs #material-tabs{border-radius:var(--tyt-rounded-a1) var(--tyt-rounded-a1) 0 0}
ytd-watch-flexy:not([is-two-columns_]) #right-tabs #material-tabs{outline:0}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content] > *{pointer-events:none}
#right-tabs #material-tabs a.tab-btn[tyt-tab-content] > .font-size-right{pointer-events:initial;display:none}
ytd-watch-flexy #right-tabs .tab-content{padding:0;box-sizing:border-box;display:block;border:1px solid var(--ytd-searchbox-legacy-border-color);border-top:0;position:relative;top:0;display:flex;flex-direction:row;overflow:hidden;border-radius:0 0 var(--tyt-rounded-a1) var(--tyt-rounded-a1)}
ytd-watch-flexy:not([is-two-columns_]) #right-tabs .tab-content{height:100%}
ytd-watch-flexy #right-tabs .tab-content-cld{box-sizing:border-box;position:relative;display:block;width:100%;overflow:auto;--tab-content-padding:var(--ytd-margin-4x);padding:var(--tab-content-padding);contain:layout paint}
.tab-content-cld,#right-tabs,.tab-content{transition:none;animation:none}
#right-tabs #emojis.ytd-commentbox{inset:auto 0 auto 0;width:auto}
ytd-watch-flexy[is-two-columns_] #right-tabs .tab-content-cld{height:100%;width:100%;contain:size style;position:absolute}
ytd-watch-flexy #right-tabs .tab-content-cld.tab-content-hidden{display:none;width:100%;contain:size layout paint style}
@supports (color: var(--tabview-tab-btn-define)) {
ytd-watch-flexy #right-tabs .tab-btn{background:var(--yt-spec-general-background-a)}
html{--tyt-tab-btn-flex-grow:1;--tyt-tab-btn-flex-basis:0;--tyt-tab-bar-color-1-def:#ff4533;--tyt-tab-bar-color-2-def:var(--yt-sys-color-baseline--genai-4,var(--yt-sys-color-baseline--static-brand-red,var(--accent-color,var(--yt-brand-light-red))));--tyt-tab-bar-color-1:var(--main-color,var(--tyt-tab-bar-color-1-def));--tyt-tab-bar-color-2:var(--main-color,var(--tyt-tab-bar-color-2-def));--tyt-tab-text-primary:var(--yt-sys-color-baseline--text-primary,var(--yt-spec-text-primary));--tyt-tab-text-secondary:var(--yt-sys-color-baseline--text-secondary,var(--yt-spec-text-secondary))}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]{flex-grow:1;flex-shrink:1;flex-basis:0;flex-grow:var(--tyt-tab-btn-flex-grow);flex-basis:var(--tyt-tab-btn-flex-basis);position:relative;display:inline-block;text-decoration:none;text-transform:uppercase;--tyt-tab-btn-color:var(--tyt-tab-text-secondary);color:var(--tyt-tab-btn-color);text-align:center;padding:14px 8px 10px;border:0;border-bottom:4px solid transparent;font-weight:500;font-size:12px;line-height:18px;cursor:pointer;transition:border 200ms linear 100ms;background-color:var(--ytd-searchbox-legacy-button-color);text-transform:var(--yt-button-text-transform,inherit);user-select:none!important;overflow:hidden;white-space:nowrap;text-overflow:clip}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg{height:18px;padding-right:0;vertical-align:bottom;opacity:.5;margin-right:0;color:var(--yt-button-color,inherit);fill:var(--iron-icon-fill-color,currentcolor);stroke:var(--iron-icon-stroke-color,none)}
ytd-watch-flexy #right-tabs .tab-btn{--tabview-btn-txt-ml:8px}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]{--tabview-btn-txt-ml:0}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg+span{margin-left:var(--tabview-btn-txt-ml)}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content] svg{pointer-events:none}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active{font-weight:500;outline:0;--tyt-tab-btn-color:var(--tyt-tab-text-primary);background-color:var(--ytd-searchbox-legacy-button-focus-color);border-bottom:2px var(--tyt-tab-bar-color-1) solid;border-bottom-color:var(--tyt-tab-bar-color-2)}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active svg{opacity:.9}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover{background-color:var(--ytd-searchbox-legacy-button-hover-color);--tyt-tab-btn-color:var(--tyt-tab-text-primary)}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover svg{opacity:.9}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]{user-select:none!important}
ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].tab-btn-hidden{display:none}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"],ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"]:hover{--tyt-tab-btn-color:var(--yt-sys-color-baseline--text-disabled,var(--yt-spec-text-disabled))}
ytd-watch-flexy[tyt-comment-disabled] #right-tabs .tab-btn[tyt-tab-content="#tab-comments"] span#tyt-cm-count:empty{display:none}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{display:inline-block;width:4em;text-align:left;font-size:inherit;color:currentColor;transform:scaleX(0.8)}
}
@supports (color: var(--tyt-cm-count-define)) {
ytd-watch-flexy{--tyt-x-loading-content-letter-spacing:2px}
html{--tabview-text-loading:Loading;--tabview-text-fetching:Fetching;--tabview-panel-loading:var(--tabview-text-loading)}
ytd-watch-flexy #right-tabs .tab-btn span#tyt-cm-count:empty::after{content:var(--tabview-text-loading);letter-spacing:var(--tyt-x-loading-content-letter-spacing)}
}
@supports (color: var(--tabview-font-size-btn-define)) {
.font-size-right{display:inline-flex;flex-direction:column;position:absolute;right:0;top:0;bottom:0;width:16px;padding:4px 0;justify-content:space-evenly;align-content:space-evenly;pointer-events:none}
html body ytd-watch-flexy.style-scope .font-size-btn{user-select:none!important}
.font-size-btn{--tyt-font-size-btn-display:none;display:var(--tyt-font-size-btn-display,none);width:12px;height:12px;color:var(--tyt-tab-text-secondary);background-color:var(--yt-spec-badge-chip-background);box-sizing:border-box;cursor:pointer;transform-origin:left top;margin:0;padding:0;position:relative;font-family:'Menlo','Lucida Console','Monaco','Consolas',monospace;line-height:100%;font-weight:900;transition:background-color 90ms linear,color 90ms linear;pointer-events:all}
.font-size-btn:hover{background-color:var(--tyt-tab-text-primary);color:var(--yt-spec-general-background-a)}
@supports (zoom: 0.5) {
.tab-btn .font-size-btn{--tyt-font-size-btn-display:none}
.tab-btn.active:hover .font-size-btn{--tyt-font-size-btn-display:inline-block}
}
}
body ytd-watch-flexy:not([is-two-columns_]) #columns.ytd-watch-flexy{flex-direction:column}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy{display:block;width:100%;box-sizing:border-box}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper{padding-left:var(--ytd-margin-6x);contain:content;height:initial}
body ytd-watch-flexy:not([is-two-columns_]) #secondary.ytd-watch-flexy secondary-wrapper #right-tabs{overflow:auto}
[tyt-chat="+"]{--tyt-chat-grow:1}
[tyt-chat="+"] secondary-wrapper > [tyt-chat-container]{flex-grow:var(--tyt-chat-grow);flex-shrink:0;display:flex;flex-direction:column}
[tyt-chat="+"] secondary-wrapper > [tyt-chat-container] > #chat{flex-grow:var(--tyt-chat-grow)}
ytd-watch-flexy[is-two-columns_]:not([theater]) #columns.style-scope.ytd-watch-flexy{min-height:calc(100vh - var(--ytd-toolbar-height,56px))}
ytd-watch-flexy[is-two-columns_]:not([full-bleed-player]) ytd-live-chat-frame#chat{min-height:initial!important;height:initial!important}
ytd-watch-flexy[tyt-tab^="#"]:not([is-two-columns_]):not([tyt-chat="+"]) #right-tabs{min-height:var(--ytd-watch-flexy-chat-max-height)}
body ytd-watch-flexy:not([is-two-columns_]) #chat.ytd-watch-flexy{margin-top:0}
body ytd-watch-flexy:not([is-two-columns_]) ytd-watch-metadata.ytd-watch-flexy{margin-bottom:0}
ytd-watch-metadata.ytd-watch-flexy ytd-metadata-row-container-renderer{display:none}
#tab-info [show-expand-button] #expand-sizer.ytd-text-inline-expander{visibility:initial}
#tab-info #collapse.button.ytd-text-inline-expander{display:none}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > #left-arrow-container.ytd-video-description-infocards-section-renderer > #left-arrow{border:6px solid transparent;opacity:.65}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > #right-arrow-container.ytd-video-description-infocards-section-renderer >#right-arrow{border:6px solid transparent;opacity:.65}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > #left-arrow-container.ytd-video-description-infocards-section-renderer > #left-arrow:hover{opacity:1}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > #right-arrow-container.ytd-video-description-infocards-section-renderer >#right-arrow:hover{opacity:1}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > div#left-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;left:-20px;top:0;z-index:-1}
#tab-info #social-links.style-scope.ytd-video-description-infocards-section-renderer > div#right-arrow-container::before{content:'';background:transparent;width:40px;display:block;height:40px;position:absolute;right:-20px;top:0;z-index:-1}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy{flex-grow:1;flex-shrink:0;display:flex;flex-direction:column}
body ytd-watch-flexy[is-two-columns_][tyt-egm-panel_] #columns.style-scope.ytd-watch-flexy #panels.style-scope.ytd-watch-flexy ytd-engagement-panel-section-list-renderer[target-id][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]{height:0;max-height:initial;min-height:initial;flex-grow:1;flex-shrink:0;display:flex;flex-direction:column}
secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #body.ytd-transcript-renderer:not(:empty),secondary-wrapper [visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"] #content.ytd-transcript-renderer:not(:empty){flex-grow:1;height:initial;max-height:initial;min-height:initial}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer{position:relative}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer > [panel-target-id]:only-child{contain:style size}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-list-renderer.ytd-transcript-search-panel-renderer{flex-grow:1;contain:strict}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer{contain:layout paint style}
secondary-wrapper #content.ytd-engagement-panel-section-list-renderer ytd-transcript-segment-renderer.style-scope.ytd-transcript-segment-list-renderer > .segment{contain:layout paint style}
body ytd-watch-flexy[theater] #secondary.ytd-watch-flexy{margin-top:var(--ytd-margin-3x);padding-top:0}
body ytd-watch-flexy[theater] secondary-wrapper{margin-top:0;padding-top:0}
body ytd-watch-flexy[theater] #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x)}
#tab-comments ytd-comments#comments [field-of-cm-count]{margin-top:0}
#tab-info > ytd-expandable-video-description-body-renderer{margin-bottom:var(--ytd-margin-3x)}
#tab-info [class]:last-child{margin-bottom:0;padding-bottom:0}
#tab-info ytd-rich-metadata-row-renderer ytd-rich-metadata-renderer{max-width:initial}
ytd-watch-flexy[is-two-columns_] secondary-wrapper #chat.ytd-watch-flexy{margin-bottom:var(--ytd-margin-3x)}
ytd-watch-flexy[tyt-tab] tp-yt-paper-tooltip{white-space:nowrap;contain:content}
ytd-watch-info-text tp-yt-paper-tooltip.style-scope.ytd-watch-info-text{margin-bottom:-300px;margin-top:-96px}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata{font-size:1.2rem;line-height:1.8rem}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata yt-animated-rolling-number{font-size:inherit}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata #info-container.style-scope.ytd-watch-info-text{align-items:center}
ytd-watch-flexy[hide-default-text-inline-expander]{--tyt-bottom-watch-metadata-margin:6px}
[hide-default-text-inline-expander] #bottom-row #description.ytd-watch-metadata > #description-inner.ytd-watch-metadata{margin:6px 12px}
[hide-default-text-inline-expander] ytd-watch-metadata[title-headline-xs] h1.ytd-watch-metadata{font-size:1.8rem}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-merch-shelf-renderer{padding:0;border:0;margin:0}
ytd-watch-flexy[is-two-columns_][hide-default-text-inline-expander] #below.style-scope.ytd-watch-flexy ytd-watch-metadata.ytd-watch-flexy{margin-bottom:6px}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--horizontal .yt-video-attribute-view-model__link-container .yt-video-attribute-view-model__hero-section{flex-shrink:0}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model__overflow-menu{background:var(--yt-emoji-picker-category-background-color);border-radius:99px}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-square.yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-height:128px}
#tab-info yt-video-attribute-view-model .yt-video-attribute-view-model--image-large .yt-video-attribute-view-model__hero-section{max-width:128px}
#tab-info ytd-reel-shelf-renderer #items.yt-horizontal-list-renderer ytd-reel-item-renderer.yt-horizontal-list-renderer{max-width:142px}
ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #view-count.style-scope.ytd-watch-info-text{align-items:center}
ytd-watch-info-text#ytd-watch-info-text.style-scope.ytd-watch-metadata #date-text.style-scope.ytd-watch-info-text{align-items:center}
ytd-watch-info-text:not([detailed]) #info.ytd-watch-info-text a.yt-simple-endpoint.yt-formatted-string{pointer-events:none}
body ytd-app > ytd-popup-container > tp-yt-iron-dropdown > #contentWrapper > [slot="dropdown-content"]{backdrop-filter:none}
#tab-info [tyt-clone-refresh-count]{overflow:visible!important}
#tab-info #items.ytd-horizontal-card-list-renderer yt-video-attribute-view-model.ytd-horizontal-card-list-renderer{contain:layout}
#tab-info #thumbnail-container.ytd-structured-description-channel-lockup-renderer{flex-shrink:0}
#tab-info ytd-media-lockup-renderer[is-compact] #thumbnail-container.ytd-media-lockup-renderer{flex-shrink:0}
secondary-wrapper ytd-donation-unavailable-renderer{--ytd-margin-6x:var(--ytd-margin-2x);--ytd-margin-5x:var(--ytd-margin-2x);--ytd-margin-4x:var(--ytd-margin-2x);--ytd-margin-3x:var(--ytd-margin-2x)}
[tyt-no-less-btn] #less{display:none}
.tyt-metadata-hover-resized #purchase-button,.tyt-metadata-hover-resized #sponsor-button,.tyt-metadata-hover-resized #analytics-button,.tyt-metadata-hover-resized #subscribe-button{display:none!important}
.tyt-metadata-hover #upload-info{max-width:max-content;min-width:max-content;flex-basis:100vw;flex-shrink:0}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #playlist-thumbnail.style-scope.ytd-structured-description-playlist-lockup-renderer{max-width:100%}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #lockup-container.ytd-structured-description-playlist-lockup-renderer{padding:1px}
#tab-info ytd-structured-description-playlist-lockup-renderer[collections] #thumbnail.ytd-structured-description-playlist-lockup-renderer{outline:1px solid rgba(127,127,127,0.5)}
ytd-live-chat-frame#chat[collapsed] ytd-message-renderer ~ #show-hide-button.ytd-live-chat-frame>ytd-toggle-button-renderer.ytd-live-chat-frame{padding:0}
.tyt-info-invisible{display:none}
[tyt-playlist-expanded] secondary-wrapper > ytd-playlist-panel-renderer#playlist{overflow:auto;flex-shrink:1;flex-grow:1;max-height:unset!important}
[tyt-playlist-expanded] secondary-wrapper > ytd-playlist-panel-renderer#playlist > #container{max-height:unset!important}
secondary-wrapper ytd-playlist-panel-renderer{--ytd-margin-6x:var(--ytd-margin-3x)}
ytd-watch-flexy[theater] ytd-playlist-panel-renderer[collapsible][collapsed] .header.ytd-playlist-panel-renderer{padding:6px 8px}
ytd-watch-flexy[theater] #playlist.ytd-watch-flexy{margin-bottom:var(--ytd-margin-2x)}
ytd-watch-flexy[theater] #right-tabs .tab-btn[tyt-tab-content]{padding:8px 4px 6px;border-bottom:0 solid transparent}
ytd-watch-flexy{--tyt-bottom-watch-metadata-margin:12px}
ytd-watch-flexy{--tyt-rounded-a1:${VAL_ROUNDED_A1}px}
ytd-watch-flexy[rounded-info-panel],ytd-watch-flexy[rounded-player-large]{--tyt-rounded-a1:${VAL_ROUNDED_A1}px}
#bottom-row.style-scope.ytd-watch-metadata .item.ytd-watch-metadata{margin-right:var(--tyt-bottom-watch-metadata-margin,12px);margin-top:var(--tyt-bottom-watch-metadata-margin,12px)}
#cinematics{contain:layout style size}
body[data-ytlstm-theater-mode] #secondary-inner[class] > secondary-wrapper[class]:not(#chat-container):not(#chat){display:flex!important}
body[data-ytlstm-theater-mode] secondary-wrapper{all:unset;height:100vh}
body[data-ytlstm-theater-mode] #right-tabs{display:none}
body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] [tyt-chat="+"]{--tyt-chat-grow:unset}
body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #columns.style-scope.ytd-watch-flexy,body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #secondary.style-scope.ytd-watch-flexy,body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #secondary-inner.style-scope.ytd-watch-flexy,body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] secondary-wrapper,body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #chat-container.style-scope,body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] [tyt-chat-container].style-scope{pointer-events:none}
body[data-ytlstm-theater-mode] [data-ytlstm-chat-over-video] #chat[class]{pointer-events:auto}
@supports (color: var(--tyt-fix-20251124)) {
#below ytd-watch-metadata .ytTextCarouselItemViewModelImageType{height:16px;width:16px}
#below ytd-watch-metadata yt-text-carousel-item-view-model{column-gap:6px}
#below ytd-watch-metadata ytd-watch-info-text#ytd-watch-info-text{font-size:inherit;line-height:inherit}
}
  `,
};
(async () => {
  // Boot/runtime hardening: window-level idempotency guard for the outer
  // (userscript-context) IIFE. Without this guard, a duplicate load
  // (HMR, tampermonkey re-injection, double @require, etc.) would call
  // GM_addElement a second time and re-evaluate executionScript, which
  // would in turn re-register every document-level listener and
  // MutationObserver on the page.
  if (typeof window !== 'undefined' && window.__ytpMainBootDone__) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__ytpMainBootDone__ = true;
  }

  // Style boot: design-system.js is loaded before main.js in build.order.json
  // (see build.order.json â€” design-system at position 6, main.js at 17), so
  // the canonical StyleManager namespace is guaranteed to be attached to
  // window.YouTubePlusDesignSystem by the time this IIFE runs. We resolve
  // the reference once, up front, so every style registration below goes
  // through a single canonical lookup rather than re-reading the global.
  //
  // The defensive guard is kept so an edge-case absence (a build-order
  // misconfiguration, a tampermonkey sandbox quirk) becomes a no-op rather
  // than a throw at boot. The previous code did the same guard inline at
  // the call site; hoisting it here is purely for readability.
  const _ds = (typeof window !== 'undefined' && window.YouTubePlusDesignSystem) || {};

  const communicationKey = `ck-${Date.now()}-${Math.floor(Math.random() * 314159265359 + 314159265359).toString(36)}`;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => {})().constructor; // YouTube hacks Promise in WaterFox Classic and "Promise.resolve(0)" nevers resolve.

  if (!document.documentElement) {
    await new Promise(
      /** @param {(value?: unknown) => void} resolve */
      resolve => {
        /**
         * Polling callback for the boot guard. Resolves the boot
         * promise as soon as `document.documentElement` is available
         * so the rest of the boot body can run.
         * @returns {void}
         */
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
  /** @type {string} */
  const textContent = `(${executionScript})("${communicationKey}");${'\n\n'}//# sourceURL=${sourceURL}${'\n'}`;

  // Style boot runs BEFORE the script injection so the canonical
  // StyleManager host already holds the right-rail CSS by the time the
  // injected page-context executionScript performs its first layout
  // pass. The StyleManager is idempotent: repeat add() with the same
  // id + css is a true no-op (last write wins on content change,
  // host textContent is not rewritten on a no-op). This means the
  // outer idempotency guard above already protects this path from
  // duplicate registration; the narrower defensive guard below is
  // only for the (theoretical) case where the canonical service
  // is missing.
  const tabviewEnabledOnLoad = window.YouTubeUtils?.loadFeatureEnabled?.('enableTabview') !== false;

  if (tabviewEnabledOnLoad) {
    if (_ds.StyleManager && typeof _ds.StyleManager.add === 'function') {
      _ds.StyleManager.add('yt-plus-tabview-core', styles.main);
    }
  }

  // GM_addElement injects the executionScript (tabview runtime) into page
  // context so it can patch ytd-* custom-element prototypes that are
  // inaccessible from the userscript (GM_addElement) sandbox.
  // Security boundary: the executionScript does NOT use unsafeWindow or
  // GM_* APIs directly — it communicates via window.YouTubeSafeDOM (_cm,
  // _mc) which are set up before injection. Any modification to
  // textContent must preserve this boundary.
  GM_addElement(document.head || document.documentElement, 'script', {
    textContent: textContent,
  });

  window.addEventListener('youtube-plus-settings-updated', (/** @type {any} */ e) => {
    try {
      const tabviewEnabled = e?.detail?.enableTabview !== false;
      if (tabviewEnabled) {
        if (_ds.StyleManager && typeof _ds.StyleManager.add === 'function') {
          _ds.StyleManager.add('yt-plus-tabview-core', styles.main);
        }
      } else {
        if (_ds.StyleManager && typeof _ds.StyleManager.remove === 'function') {
          _ds.StyleManager.remove('yt-plus-tabview-core');
        }
      }
    } catch (_e) {
      // Ignore
    }
  });
})();
