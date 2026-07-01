/**
 * design-system.js - canonical style / design-system module.
 *
 * Owns:
 *   - Theme synchronization: mirror YouTube's resolved theme (dark/light) onto
 *     <html> so theme-aware CSS rules in `html[light]` / `html[dark]` apply.
 *   - StyleManager: keyed CSS registry, single style host, idempotent add.
 *     - Stable: every public method is total and side-effect-bounded (no
 *       throw, no host reset on no-op, no listener leaks on early calls).
 *     - Idempotent: add(id, css) cleanly updates CSS for an existing id
 *       (last write wins). Repeat calls with the same id and css are true
 *       no-ops; the host textContent is not rewritten, so the browser does
 *       not re-run style invalidation. add(id, '') is treated as remove(id)
 *       so callers can use add() as a uniform "set or clear" entry point.
 *       remove(id) on an unknown id is a no-op.
 *     - Mass-migration ready: keyed registry + introspection
 *       (has/get/size/ids/host) + single canonical style host element, so
 *       modules keep only their logic and reference their CSS by id.
 *   - Design-system token CSS bundle (`yt-plus-design-system`): CSS variables,
 *     shared component classes (`.ytp-plus-btn`, `.ytp-plus-panel`, etc.).
 *   - Central static-CSS registry: read-only lookup of static stylesheets by
 *     id via `getStyle(id)`. Dynamic CSS (settings-driven, runtime values)
 *     stays in its module.
 *
 * Back-compat shim only (do not use in new code):
 *   - Modifier-combo formatter/builder helpers
 *   - Glass dropdown initializer
 *   Canonical home: src/modal-handlers.js -> window.YouTubePlusModalHandlers.
 *   Exposed here as a thin lazy delegating bridge.
 *
 * Module must remain dependency-free for userscript use.
 */
// @ts-check
// ---------------------------------------------------------------------------
// Theme synchronization: YouTube only sets the `dark` attribute on <html>
// when dark theme is active and removes it (no `light` attr is added) when
// switching back to light. Several modules and the design-system itself ship
// CSS scoped under `html[light]` for light-mode overrides; without an explicit
// `light` attribute those rules never apply, so light-theme users see dark
// surfaces. Mirror the resolved theme onto <html> (as either `dark` or
// `light`) so theme-aware CSS works in both directions. Run as early as
// possible so styles resolve correctly on first paint.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined' || !document.documentElement) return;

  const html = document.documentElement;
  const THEME_FLAG = '__ytplusThemeSync';
  /** @type {any} */
  const win = typeof window !== 'undefined' ? window : {};
  if (win[THEME_FLAG]) return;
  win[THEME_FLAG] = true;

  /** @returns {'dark' | 'light'} */
  /**
   * Resolve the current YouTube theme from DOM attributes.
   * @returns {'dark' | 'light'} Resolved theme
   */
  const resolveTheme = () => {
    try {
      if (html.hasAttribute('dark')) return 'dark';
      const app = document.querySelector('ytd-app, ytmusic-app');
      if (app instanceof Element && app.hasAttribute('dark')) return 'dark';
      const body = document.body;
      if (body?.hasAttribute('dark')) return 'dark';
    } catch (_err) {
      void _err;
    }
    return 'light';
  };

  let scheduled = false;
  let applying = false;
  /** @type {'dark' | 'light' | null} */
  let lastApplied = null;

  const applyTheme = () => {
    scheduled = false;
    const theme = resolveTheme();
    if (theme === lastApplied) return;
    applying = true;
    try {
      lastApplied = theme;
      if (theme === 'dark') {
        html.removeAttribute('light');
        html.setAttribute('data-ytp-theme', 'dark');
      } else {
        html.setAttribute('light', '');
        html.setAttribute('data-ytp-theme', 'light');
      }
    } finally {
      applying = false;
    }
  };

  /**
   * Schedule a theme synchronization on the next animation frame.
   * No-op if already scheduled or currently applying.
   */
  const schedule = () => {
    if (scheduled || applying) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(applyTheme);
    } else {
      setTimeout(applyTheme, 0);
    }
  };

  // Apply immediately so first paint uses the resolved theme.
  applyTheme();

  // Route theme-sync observation through the shared MutationCoordinator
  // instead of creating 3 separate MutationObservers (html, body/ytd-app,
  // root insertion). A single subscribeRoot call with the right filter
  // covers all three: attribute changes on <html>/body/ytd-app and
  // childList changes for ytd-app insertion detection.
  //
  // We still guard against our own writes via the `applying` flag to
  // prevent feedback loops.
  const mc =
    typeof window !== 'undefined'
      ? /** @type {any} */ (window).YouTubePlusMutationCoordinator
      : null;
  if (mc && typeof mc.subscribeRoot === 'function') {
    mc.subscribeRoot(
      'design-system:theme-sync',
      /** @param {MutationRecord[]} records */
      records => {
        if (applying) return;
        for (const rec of records) {
          if (rec.type === 'attributes') {
            // Skip our own data-ytp-theme writes to avoid feedback.
            if (rec.attributeName === 'data-ytp-theme') continue;
            if (rec.attributeName === 'dark' || rec.attributeName === 'light') {
              const hasDark = html.hasAttribute('dark');
              const expectedDark = lastApplied === 'dark';
              if (hasDark === expectedDark) continue;
              schedule();
              return;
            }
          } else if (rec.type === 'childList' && rec.addedNodes.length > 0) {
            // ytd-app / ytmusic-app may have been inserted — re-check theme.
            schedule();
            return;
          }
        }
      },
      {
        attributes: true,
        attributeFilter: ['dark', 'light', 'data-ytp-theme'],
        childList: true,
        subtree: true,
      }
    );
  }

  // Track user-agent / OS theme changes (only when YouTube hasn't decided).
  try {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => schedule();
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
      else if (typeof mq.addListener === 'function') mq.addListener(onChange);
    }
  } catch (_err) {
    void _err;
  }

  // Expose for tests / other modules.
  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      .../** @type {any} */ (window.YouTubePlusDesignSystem || {}),
      resolveTheme,
      syncTheme: schedule,
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDesignSystem = window.YouTubePlusDesignSystem;
    }
  }
})();

(function () {
  const logger = window.YouTubePlusLogger || window.YouTubeUtils?.logger || null;
  const U = window.YouTubeUtils;

  const STYLE_HOST_ID = 'youtube-plus-styles';
  const styles = new Map();
  /** @type {HTMLStyleElement | null} */
  let styleHost = null;
  /** @type {boolean} */
  let earlyRenderListener = false;
  /** @type {MutationObserver | null} */
  let headObserver = null;
  /** @type {MutationObserver | null} */
  let documentObserver = null;
  /** @type {Node | null} */
  let observedHeadRoot = null;
  /** @type {MutationObserver | null} */
  let styleObserver = null;
  /** @type {boolean} */
  let renderScheduled = false;

  const computeRenderText = () => Array.from(styles.values()).join('\n\n');

  const ensureStyleObserver = () => {
    if (styleObserver) return;
    if (typeof MutationObserver === 'undefined') return;
    const host = styleHost?.isConnected ? styleHost : ensureStyleHost();
    if (!host) return;
    styleObserver = new MutationObserver(() => {
      ensureRenderedStylesAlive();
    });
    try {
      styleObserver.observe(host, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    } catch (_error) {
      void _error;
    }
    const parent = host.parentNode;
    if (parent) {
      try {
        styleObserver.observe(parent, { childList: true, subtree: false });
      } catch (_error) {
        void _error;
      }
    }
    const cm =
      (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) ||
      (typeof window !== 'undefined' && U && U.cleanupManager) ||
      null;
    if (cm && typeof cm.registerObserver === 'function') {
      try {
        cm.registerObserver(styleObserver);
      } catch (_error) {
        void _error;
      }
    }
  };

  /**
   * Schedule a render of all registered styles on the next animation frame.
   */
  const scheduleRender = () => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      renderScheduled = false;
      renderStyles();
      return;
    }
    if (renderScheduled) return;
    renderScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        renderScheduled = false;
        renderStyles();
      });
    } else {
      setTimeout(() => {
        renderScheduled = false;
        renderStyles();
      }, 0);
    }
  };

  /**
   * Ensure the style host element exists and is connected to the DOM.
   * @returns {HTMLStyleElement | null} The style host element, or null if unavailable
   */
  const ensureStyleHost = () => {
    if (styleHost?.isConnected) {
      return styleHost;
    }
    const existing = /** @type {HTMLStyleElement | null} */ (
      document.getElementById(STYLE_HOST_ID)
    );
    if (existing) {
      styleHost = existing;
      ensureStyleObserver();
      return styleHost;
    }
    if (!(document.head || document.documentElement)) return null;
    const created = document.createElement('style');
    created.id = STYLE_HOST_ID;
    created.type = 'text/css';
    (document.head || document.documentElement).appendChild(created);
    styleHost = created;
    if (styleObserver) {
      try {
        styleObserver.disconnect();
      } catch (_error) {
        void _error;
      }
      styleObserver = null;
    }
    ensureStyleObserver();
    return styleHost;
  };

  /**
   * Check if the rendered styles match the expected state and re-render if needed.
   */
  const ensureRenderedStylesAlive = () => {
    if (styles.size === 0) return;
    const connectedHost = styleHost?.isConnected
      ? styleHost
      : /** @type {HTMLStyleElement | null} */ (document.getElementById(STYLE_HOST_ID));
    const expected = computeRenderText();
    if (!connectedHost || connectedHost.textContent !== expected) {
      scheduleRender();
      return;
    }
    styleHost = connectedHost;
  };

  const observeStyleContainers = () => {
    if (typeof MutationObserver === 'undefined') return;

    if (!documentObserver && document.documentElement) {
      documentObserver = new MutationObserver(() => {
        const nextHeadRoot = document.head || document.documentElement;
        if (nextHeadRoot !== observedHeadRoot) {
          if (headObserver) {
            try {
              headObserver.disconnect();
            } catch (_error) {
              void _error;
            }
            headObserver = null;
          }
          observedHeadRoot = nextHeadRoot;
          if (nextHeadRoot) {
            headObserver = new MutationObserver(() => {
              ensureRenderedStylesAlive();
            });
            try {
              headObserver.observe(nextHeadRoot, {
                childList: true,
                subtree: false,
              });
            } catch (_error) {
              headObserver = null;
            }
          }
        }
        ensureRenderedStylesAlive();
      });
      try {
        documentObserver.observe(document.documentElement, {
          childList: true,
          subtree: false,
        });
      } catch (_error) {
        documentObserver = null;
      }
      const _cmDoc =
        (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) ||
        (typeof window !== 'undefined' && U && U.cleanupManager) ||
        null;
      if (_cmDoc && typeof _cmDoc.registerObserver === 'function' && documentObserver) {
        try {
          _cmDoc.registerObserver(documentObserver);
        } catch (_error) {
          void _error;
        }
      }
    }

    const nextHeadRoot = document.head || document.documentElement;
    if (!headObserver && nextHeadRoot) {
      observedHeadRoot = nextHeadRoot;
      headObserver = new MutationObserver(() => {
        ensureRenderedStylesAlive();
      });
      try {
        headObserver.observe(nextHeadRoot, {
          childList: true,
          subtree: false,
        });
      } catch (_error) {
        headObserver = null;
      }
      const _cmHead =
        (typeof window !== 'undefined' && window.YouTubePlusCleanupManager) ||
        (typeof window !== 'undefined' && U && U.cleanupManager) ||
        null;
      if (_cmHead && typeof _cmHead.registerObserver === 'function' && headObserver) {
        try {
          _cmHead.registerObserver(headObserver);
        } catch (_error) {
          void _error;
        }
      }
    }
  };

  observeStyleContainers();

  const renderStyles = () => {
    try {
      const host = ensureStyleHost();
      const nextText = computeRenderText();
      if (host) {
        if (host.textContent !== nextText) host.textContent = nextText;
        return;
      }
      if (earlyRenderListener) return;
      earlyRenderListener = true;
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          earlyRenderListener = false;
          const lateHost = ensureStyleHost();
          if (!lateHost) return;
          const lateText = computeRenderText();
          if (lateHost.textContent !== lateText) lateHost.textContent = lateText;
        },
        { once: true }
      );
    } catch (error) {
      logger?.error?.('design-system', 'StyleManager render failed', error);
    }
  };

  /**
   * Check whether a stylesheet is registered.
   * @param {string} id
   * @returns {boolean}
   */
  const has = id => styles.has(id);

  /**
   * Retrieve a previously registered stylesheet by id (empty string if absent).
   * @param {string} id
   * @returns {string}
   */
  const get = id =>
    typeof id === 'string' && styles.has(id) ? /** @type {string} */ (styles.get(id)) : '';

  /**
   * Add or update a stylesheet keyed by id.
   *
   * Repeat calls with the same id cleanly update the CSS for that id (the
   * last write wins). Calling add() with the same id and css is a true
   * no-op: the host textContent is not rewritten, so no style recalc is
   * triggered. An empty string is treated as remove() so callers can use
   * add() as a uniform "set or clear" entry point.
   *
   * @param {string} id
   * @param {string} css
   * @returns {void}
   */
  const add = (id, css) => {
    try {
      if (typeof id !== 'string' || !id) return;
      if (typeof css !== 'string') return;
      if (css === '') {
        remove(id);
        return;
      }
      ensureStyleObserver();
      if (styles.get(id) === css) {
        const connectedHost = styleHost?.isConnected
          ? styleHost
          : /** @type {HTMLStyleElement | null} */ (document.getElementById(STYLE_HOST_ID));
        if (!connectedHost || connectedHost.textContent !== computeRenderText()) {
          scheduleRender();
        }
        return;
      }
      styles.set(id, css);
      scheduleRender();
    } catch (error) {
      logger?.error?.('design-system', `StyleManager add('${id}') failed`, error);
    }
  };

  /**
   * Remove a stylesheet by id. Calling remove() with an unknown id is a
   * no-op; no re-render is triggered.
   * @param {string} id
   * @returns {void}
   */
  const remove = id => {
    try {
      if (typeof id !== 'string' || !id) return;
      if (!styles.has(id)) return;
      styles.delete(id);
      scheduleRender();
    } catch (error) {
      logger?.error?.('design-system', `StyleManager remove('${id}') failed`, error);
    }
  };

  /**
   * Remove every registered stylesheet and detach the host element. The
   * host is recreated lazily on the next add() so the manager stays usable
   * after clear().
   * @returns {void}
   */
  const clear = () => {
    try {
      styles.clear();
      if (styleHost) {
        styleHost.remove();
        styleHost = null;
      }
      if (styleObserver) {
        try {
          styleObserver.disconnect();
        } catch (_error) {
          void _error;
        }
        styleObserver = null;
      }
    } catch (error) {
      logger?.error?.('design-system', 'StyleManager clear failed', error);
    }
  };

  /**
   * Number of registered stylesheets.
   * @returns {number}
   */
  const size = () => styles.size;

  /**
   * List the ids of registered stylesheets, in insertion order.
   * @returns {string[]}
   */
  const ids = () => Array.from(styles.keys());

  const styleManager = {
    hostId: STYLE_HOST_ID,
    styles,
    has,
    get,
    add,
    remove,
    clear,
    size,
    ids,
    /**
     * The current style host element (the `<style>` element the manager
     * renders into), or null after clear() until the next add().
     * @returns {HTMLStyleElement | null}
     */
    get host() {
      return styleHost;
    },
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      ...(window.YouTubePlusDesignSystem || {}),
      StyleManager: window.YouTubePlusDesignSystem?.StyleManager || styleManager,
      /**
       * Re-check and re-render styles if the host element was removed.
       */
      repairStyles: ensureRenderedStylesAlive,
      /**
       * Inspect the current state of the style host and registered styles.
       * @returns {{ hostPresent: boolean, hostConnected: boolean, hostTextLength: number, expectedTextLength: number, registeredStyleIds: string[], textMatchesExpected: boolean }}
       */
      inspectStyles: () => {
        const host = styleHost?.isConnected
          ? styleHost
          : /** @type {HTMLStyleElement | null} */ (document.getElementById(STYLE_HOST_ID));
        const expected = computeRenderText();
        return {
          hostPresent: !!host,
          hostConnected: !!host?.isConnected,
          hostTextLength: host?.textContent?.length || 0,
          expectedTextLength: expected.length,
          registeredStyleIds: Array.from(styles.keys()),
          textMatchesExpected: (host?.textContent || '') === expected,
        };
      },
    };
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDesignSystem = window.YouTubePlusDesignSystem;
    }
  }

  styleManager.add(
    'yt-plus-design-system',
    `
    :root{
      --yt-accent:#ff0000;
      --yt-accent-secondary:#1976d2;
      --yt-accent-secondary-light:#42a5f5;
      --yt-accent-secondary-ghost:rgba(25,118,210,0.28);
      --yt-accent-secondary-light-ghost:rgba(66,165,245,0.4);
      --yt-accent-secondary-shadow:rgba(25,118,210,0.25);
      --yt-primary-soft:rgba(33,150,243,.12);
      --yt-primary-soft-hover:rgba(33,150,243,.22);
      --yt-primary-border:rgba(33,150,243,.25);
      --yt-primary-text:#2196f3;
      --yt-surface-soft:rgba(255,255,255,.08);
      --yt-surface-active:rgba(255,255,255,.12);
      --yt-surface-active-strong:rgba(255,255,255,.14);
      --yt-surface-border-strong:rgba(255,255,255,.15);
      --yt-surface-overlay-soft:rgba(255,255,255,.1);
      --yt-surface-overlay-subtle:rgba(255,255,255,.04);
      --yt-surface-overlay-faint:rgba(255,255,255,.02);
      --yt-surface-overlay-border:rgba(255,255,255,.06);
      --yt-danger-soft:rgba(255,59,59,0.15);
      --yt-danger-soft-hover:rgba(255,59,59,0.25);
      --yt-danger-border:rgba(255,59,59,0.3);
      --yt-danger-text:#ff5c5c;
      --yt-danger-ghost:rgba(255,0,0,.12);
      --yt-danger-shadow:rgba(255,0,0,.3);
      --yt-danger-shadow-strong:rgba(255,0,0,.35);
      --yt-danger-card-bg-start:rgba(255,0,0,.28);
      --yt-danger-card-bg-end:rgba(255,0,0,.16);
      --yt-danger-card-border:rgba(255,0,0,.45);
      --yt-danger-card-inset:rgba(255,0,0,.22);
      --yt-success:#4caf50;
      --yt-success-soft:rgba(76,175,80,0.2);
      --yt-success-soft-hover:rgba(76,175,80,.22);
      --yt-danger:#f44336;
      --yt-warning:#ffc107;
      --yt-warning-soft:rgba(255,193,7,0.2);
      --yt-shadow-soft:rgba(0,0,0,.2);
      --yt-shadow-soft-strong:rgba(0,0,0,.3);
      --yt-shadow-inset-soft:rgba(0,0,0,.04);
      --yt-shadow-inset-strong:rgba(0,0,0,.35);
      --yt-shadow-flyout:rgba(0,0,0,.5);
       --yt-shadow-notification:rgba(0,0,0,.3);
       --yt-shadow-deep-1:rgba(0,0,0,.15);
       --yt-shadow-deep-2:rgba(0,0,0,.1);
       --yt-shadow-deep-3:rgba(0,0,0,.06);
       --yt-shadow-deep-4:rgba(0,0,0,.09);
       --yt-border-light:rgba(0,0,0,.25);
       --yt-overlay-strong:rgba(0,0,0,.55);
       --yt-overlay-deep:rgba(0,0,0,.2);
       --yt-overlay-faint:rgba(0,0,0,.15);
       --yt-tab-color-accent:#ff4533;
       --yt-scrollbar-outline:rgba(127,127,127,.5);
       --yt-panel-overlay-subtle:rgba(0,0,0,.05);
      --yt-scrollbar-thumb:rgba(144,144,144,.5);
      --yt-scrollbar-thumb-hover:rgba(170,170,170,.7);
      --yt-panel-overlay-weak:rgba(0,0,0,.02);
      --yt-badge-bg-light:rgba(255,255,255,.1);
      --yt-badge-bg-dark:rgba(0,0,0,.05);
      --yt-text-dark-primary:#0f0f0f;
      --yt-playall-accent-purple:#bf4bcc;
      --yt-playall-accent-blue:#2b66da;
      --yt-search-highlight-bg:rgba(255,99,71,.12);
      --yt-search-highlight-border:rgba(255,99,71,.25);
      --yt-search-highlight-border-strong:rgba(255,99,71,.4);
      --yt-search-highlight-faint:rgba(255,99,71,.1);
      --yt-search-highlight-hover:rgba(255,99,71,.22);
      --yt-search-highlight-accent:#ff5c5c;
      --yt-shorts-shadow-deep:rgba(0,0,0,.4);
      --yt-shorts-overlay-gray:rgba(155,155,155,.15);
      --yt-shorts-border-light:rgba(255,255,255,.2);
      --yt-shorts-shadow-blue:rgba(31,38,135,.37);
      --yt-shorts-feedback-bg-dark:rgba(34,34,34,.7);
      --yt-shorts-feedback-bg-light:rgba(255,255,255,.95);
      --yt-shorts-border-dark:rgba(0,0,0,.08);
      --yt-shorts-help-bg-light:rgba(255,255,255,.98);
      --yt-shorts-header-bg:rgba(255,255,255,.05);
      --yt-shorts-header-bg-light:rgba(0,0,0,.04);
      --yt-shorts-kbd-bg:rgba(255,255,255,.15);
      --yt-shorts-kbd-border:rgba(255,255,255,.2);
      --yt-shorts-kbd-bg-light:rgba(0,0,0,.06);
      --yt-shorts-kbd-hover:rgba(255,255,255,.22);
      --yt-shorts-text-secondary:rgba(255,255,255,.92);
      --yt-shorts-footer-bg:rgba(255,255,255,.05);
      --yt-shorts-footer-bg-light:rgba(0,0,0,.04);
      --yt-shorts-panel-header:rgba(255,255,255,.1);
      --yt-shorts-panel-header-bg:rgba(255,255,255,.05);
      --yt-shorts-feedback-bg:rgba(255,255,255,.15);
      --yt-shorts-feedback-border:rgba(255,255,255,.2);
      --yt-shorts-help-bg:rgba(255,255,255,.15);
      --yt-shorts-help-border:rgba(255,255,255,.2);
      --yt-shorts-kbd-non-editable:rgba(0,0,0,.08);
      --yt-muted-text:#666;
      --yt-success-accent:#10c56a;
      --yt-success-accent-soft:rgba(16,197,106,0.15);
      --yt-surface-contrast:#111;
      --yt-progress-track:#e0e0e0;
      --yt-progress-fill:#1a73e8;
      --yt-modal-surface:rgba(20,20,20,.64);
      --yt-radius-xs:6px;
      --yt-radius-sm:10px;
      --yt-radius-md:14px;
      --yt-radius-lg:20px;
      --yt-space-sm:8px;
      --yt-space-md:16px;
      --yt-space-lg:24px;
      --yt-transition-fast:all .14s cubic-bezier(.2,.8,.2,1);
      --yt-transition-default:all .24s cubic-bezier(.2,.8,.2,1);
      --yt-glass-blur:blur(18px) saturate(180%);
      --yt-glass-blur-light:blur(12px) saturate(160%);
      --yt-glass-blur-heavy:blur(24px) saturate(200%);
      --yt-z-overlay:1000;
      --yt-z-flyout:20000;
      --yt-z-modal:100000;
      --yt-stats-icon-views-bg:rgba(59,130,246,0.15);
      --yt-stats-icon-views:#3b82f6;
      --yt-stats-icon-likes-bg:rgba(34,197,94,0.15);
      --yt-stats-icon-likes:#22c55e;
      --yt-stats-icon-dislikes-bg:rgba(239,68,68,0.15);
      --yt-stats-icon-dislikes:#ef4444;
      --yt-stats-icon-comments-bg:rgba(168,85,247,0.15);
      --yt-stats-icon-comments:#a855f7;
      --yt-stats-icon-viewers-bg:rgba(234,179,8,0.15);
      --yt-stats-icon-viewers:#eab308;
      --yt-stats-icon-subscribers-bg:rgba(236,72,153,0.15);
      --yt-stats-icon-subscribers:#ec4899;
      --yt-stats-icon-videos-bg:rgba(14,165,233,0.15);
      --yt-stats-icon-videos:#0ea5e9;
      --yt-stats-card-bg-dark:rgba(255,255,255,0.05);
      --yt-stats-card-bg-light:rgba(0,0,0,0.03);
      --yt-stats-card-border-dark:rgba(255,255,255,0.08);
      --yt-stats-card-border-light:rgba(0,0,0,0.1);
      --yt-stats-text-secondary-dark:rgba(255,255,255,0.65);
      --yt-stats-text-secondary-light:rgba(0,0,0,0.6);
      --yt-stats-text-label:rgba(255,255,255,0.72);
      --yt-stats-text-exact-dark:rgba(255,255,255,0.5);
      --yt-stats-text-exact-light:rgba(0,0,0,0.5);
      --yt-stats-text-value-dark:#fff;
      --yt-stats-text-value-light:#111;
      --yt-stats-error:#ff6b6b;
      --yt-stats-link-color:#0b61d6;
      --yt-stats-link-hover:#e6f0ff;
      --yt-stats-link-hover-dark:#0647a6;
      --yt-stats-loader-text-dark:#fff;
      --yt-stats-loader-text-light:#666;
      --yt-stats-shadow-hover:rgba(0,0,0,0.3);
      --yt-stats-shadow-deep:rgba(0,0,0,0.32);
      --yt-stats-modal-shadow:rgba(0,0,0,0.45);
      --yt-stats-bg-overlay-dark:rgba(28,28,28,0.75);
      --yt-stats-img-border-dark:rgba(255,255,255,0.06);
      --yt-stats-img-border-light:rgba(0,0,0,0.06);
      --yt-stats-button-bg-dark:rgba(24,24,24,0.68);
      --yt-stats-button-border-dark:rgba(255,255,255,0.08);
      --yt-stats-button-border-light:rgba(0,0,0,0.06);
      --yt-stats-button-bg-light:rgba(255,255,255,0.12);
      --yt-stats-author-name-bright:rgba(255,255,255,0.9);
      --yt-stats-author-name-light:rgba(0,0,0,0.8);
      --yt-stats-channel-button-bg:rgba(0,0,0,0.4);
      --yt-stats-channel-button-border:rgba(255,255,255,0.1);
      --yt-stats-channel-button-hover:rgba(0,0,0,0.6);
      --yt-stats-channel-button-hover-border:rgba(255,255,255,0.3);
      --yt-stats-channel-menu-bg:rgba(28,28,28,0.75);
      --yt-stats-channel-menu-border:rgba(255,255,255,0.08);
      --yt-stats-channel-menu-item-bg:rgba(255,255,255,0.02);
      --yt-stats-channel-label-text:#eee;
      --yt-stats-channel-input-bg:rgba(255,255,255,0.1);
      --yt-stats-channel-input-hover:rgba(255,255,255,0.15);
      --yt-stats-channel-select-option-bg:#333;
      --yt-stats-channel-range-bg:rgba(255,255,255,0.2);
      --yt-stats-channel-range-thumb:#3ea6ff;
      --yt-stats-channel-checkbox-border:rgba(255,255,255,0.4);
      --yt-stats-channel-text-value:#bbb;
      --yt-stats-channel-text-shadow:rgba(0,0,0,0.3);
      --yt-stats-link-color:#0b61d6;
      --yt-stats-link-hover-dark:#0647a6;
      --yt-stats-positive-indicator:#1ed760;
      --yt-stats-negative-indicator:#f3727f;
      --yt-stats-channel-filter-shadow:rgba(0,0,0,0.5);
      --yt-timecode-panel-bg-dark:rgba(34,34,34,0.75);
      --yt-timecode-panel-bg-light:rgba(255,255,255,0.95);
      --yt-timecode-panel-border-dark:rgba(255,255,255,0.12);
      --yt-timecode-panel-border-light:rgba(0,0,0,0.08);
      --yt-timecode-panel-color-dark:#fff;
      --yt-timecode-panel-color-light:#222;
      --yt-timecode-panel-shadow:rgba(0,0,0,0.45);
      --yt-timecode-active-bg-start:rgba(255,68,68,0.12);
      --yt-timecode-active-bg-end:rgba(255,68,68,0.04);
      --yt-timecode-active-border:#ff6666;
      --yt-timecode-active-inset:rgba(255,68,68,0.03);
      --yt-timecode-chapter:#ff4444;
      --yt-timecode-toggle-active-start:#ff6b6b;
      --yt-timecode-export-success-bg:rgba(0,220,0,0.8);
      --yt-update-card-shadow:rgba(6,10,20,0.45);
      --yt-update-available-dot:#ff4444;
      --yt-update-available-text:#ff6666;
      --yt-update-install-bg-start:#ff4500;
      --yt-update-install-bg-end:#ff6b35;
      --yt-update-install-shadow:rgba(255,69,0,0.3);
      --yt-thumbnail-overlay-idle:rgba(0,0,0,0.3);
      --yt-thumbnail-overlay-hover:rgba(0,0,0,0.7);
      --yt-thumbnail-overlay-active:rgba(0,0,0,0.9);
    }

    html[dark],html[data-ytp-theme="dark"]{
      --yt-bg-primary:rgba(15,15,15,.85);
      --yt-bg-secondary:rgba(28,28,28,.85);
      --yt-bg-tertiary:rgba(34,34,34,.85);
      --yt-text-primary:#fff;
      --yt-text-secondary:#aaa;
      --yt-border-color:rgba(255,255,255,.2);
      --yt-hover-bg:rgba(255,255,255,.1);
      --yt-shadow:0 4px 12px rgba(0,0,0,.25);
      --yt-glass-bg:rgba(50,50,50,.5);
      --yt-glass-border:rgba(255,255,255,.2);
      --yt-glass-shadow:0 8px 32px rgba(0,0,0,.2);
      --yt-modal-bg:rgba(0,0,0,.75);
      --yt-notification-bg:rgba(28,28,28,.9);
      --yt-panel-bg:rgba(34,34,34,.3);
      --yt-header-bg:rgba(20,20,20,.6);
      --yt-input-bg:rgba(255,255,255,.1);
      --yt-button-bg:rgba(255,255,255,.2);
      --yt-text-stroke:#fff;
      --yt-rail-gradient-start:rgba(255,255,255,.06);
      --yt-rail-gradient-end:rgba(255,255,255,.03);
      --yt-rail-inset:rgba(255,255,255,.08);
    }

    html[light],html[data-ytp-theme="light"],html:not([dark]):not([data-ytp-theme="dark"]){
      --yt-bg-primary:rgba(255,255,255,.85);
      --yt-bg-secondary:rgba(248,248,248,.85);
      --yt-bg-tertiary:rgba(240,240,240,.85);
      --yt-text-primary:#030303;
      --yt-text-secondary:#606060;
      --yt-border-color:rgba(0,0,0,.2);
      --yt-hover-bg:rgba(0,0,0,.05);
      --yt-shadow:0 4px 12px rgba(0,0,0,.15);
      --yt-glass-bg:rgba(255,255,255,.7);
      --yt-glass-border:rgba(0,0,0,.1);
      --yt-glass-shadow:0 8px 32px rgba(0,0,0,.1);
      --yt-modal-bg:rgba(0,0,0,.5);
      --yt-notification-bg:rgba(255,255,255,.95);
      --yt-panel-bg:rgba(255,255,255,.7);
      --yt-header-bg:rgba(248,248,248,.8);
      --yt-input-bg:rgba(0,0,0,.05);
      --yt-button-bg:rgba(0,0,0,.1);
      --yt-text-stroke:#030303;
      --yt-rail-gradient-start:rgba(0,0,0,.04);
      --yt-rail-gradient-end:rgba(0,0,0,.02);
      --yt-rail-inset:rgba(0,0,0,.06);
    }

    .ytp-plus-btn{
      padding:var(--yt-space-sm) var(--yt-space-md);
      border-radius:18px;
      border:1px solid var(--yt-glass-border);
      font-size:14px;
      font-weight:500;
      cursor:pointer;
      color:var(--yt-text-primary);
      background:var(--yt-button-bg);
      transition:var(--yt-transition-default);
    }
    .ytp-plus-btn:hover{
      transform:translateY(-1px);
      box-shadow:var(--yt-shadow);
      background:var(--yt-hover-bg);
    }
    .ytp-plus-btn--primary{
      background:transparent;
    }
    .ytp-plus-btn--primary:hover{
      background:var(--yt-accent);
      color:#fff;
      box-shadow:0 6px 16px rgba(255,0,0,.35);
    }

    .ytp-plus-panel{
      background:var(--yt-glass-bg);
      border:1px solid var(--yt-glass-border);
      border-radius:var(--yt-radius-md);
      box-shadow:var(--yt-glass-shadow);
      color:var(--yt-text-primary);
    }

    .ytp-plus-modal-overlay{
      position:fixed;
      inset:0;
      background:var(--yt-modal-bg);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:var(--yt-z-modal);
      backdrop-filter:blur(8px) saturate(140%);
      -webkit-backdrop-filter:blur(8px) saturate(140%);
      animation:ytEnhanceFadeIn .25s ease-out;
    }

    .ytp-plus-modal-content{
      background:var(--yt-glass-bg);
      border:1.5px solid var(--yt-glass-border);
      border-radius:24px;
      color:var(--yt-text-primary);
      box-shadow:0 12px 40px rgba(0,0,0,.45);
      backdrop-filter:blur(14px) saturate(140%);
      -webkit-backdrop-filter:blur(14px) saturate(140%);
      animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);
    }

    @keyframes ytEnhanceFadeIn{from{opacity:0;}to{opacity:1;}}
    @keyframes ytEnhanceScaleIn{from{opacity:0;transform:scale(.92) translateY(10px);}to{opacity:1;transform:scale(1) translateY(0);}}
    @keyframes fadeInModal{from{opacity:0}to{opacity:1}}
    @keyframes scaleInModal{from{transform:scale(0.95);opacity:0}to{transform:scale(1);opacity:1}}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes dash{0%{stroke-dashoffset:80}50%{stroke-dashoffset:10}100%{stroke-dashoffset:80}}
    @keyframes slideInFromBottom{from{transform:translateY(100%);opacity:0;}to{transform:translateY(0);opacity:1;}}
    @keyframes slideOutToBottom{from{transform:translateY(0);opacity:1;}to{transform:translateY(100%);opacity:0;}}

    @keyframes ytp-resume-fadein{from{opacity:0;}to{opacity:1;}}

    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{
        animation:none !important;
        transition:none !important;
      }
    }
  `
  );
})();

(function () {
  // ===========================================================================
  // Central static-CSS registry
  // ---------------------------------------------------------------------------
  // Modules keep only their logic and reference their stylesheet here by id via
  // `window.YouTubePlusDesignSystem.getStyle(id)`. Only fully static CSS lives
  // here; CSS that is generated from runtime values (user settings, dynamic
  // selectors, percentages) stays in its module because it cannot be a constant.
  // ===========================================================================
  const STYLE_BUNDLES = {
    'ytp-screenshot-styles': `.ytp-screenshot-button,.ytp-cobalt-button,.ytp-pip-button{position:relative;width:44px;height:100%;display:inline-flex;align-items:center;justify-content:center;vertical-align:top;transition:opacity .15s,transform .15s;}.ytp-screenshot-button:hover,.ytp-cobalt-button:hover,.ytp-pip-button:hover{transform:scale(1.1);}`,
    'ytp-speedcontrol-styles': `
        .speed-control-btn{width:4em!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;text-align:center!important;border-radius:var(--yt-radius-sm);font-size:13px;color:var(--yt-text-primary);cursor:pointer;user-select:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;transition:color .2s;}
        .speed-control-btn:hover{color:var(--yt-accent);font-weight:bold;}
        .speed-options{position:fixed!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;border-radius:var(--yt-radius-md)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:0!important;transform:translate(-50%,12px)!important;width:92px!important;z-index:2147483647!important;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;opacity:0;pointer-events:none!important;transition:opacity .18s ease,transform .18s ease;box-sizing:border-box;}
        .speed-options.visible{opacity:1;pointer-events:auto!important;transform:translate(-50%,0)!important;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
        .speed-option-item{cursor:pointer!important;height:28px!important;line-height:28px!important;font-size:12px!important;text-align:center!important;transition:background-color .15s,color .15s;}
        .speed-option-active,.speed-option-item:hover{color:var(--yt-accent)!important;font-weight:bold!important;background:var(--yt-hover-bg)!important;}
        #speed-indicator{position:absolute!important;margin:auto!important;top:0!important;right:0!important;bottom:0!important;left:0!important;border-radius:24px!important;font-size:30px!important;background:var(--yt-glass-bg)!important;color:var(--yt-text-primary)!important;z-index:99999!important;width:80px!important;height:80px!important;line-height:80px!important;text-align:center!important;display:none;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);}
        .speed-submenu{margin:4px 0 12px 12px;}
        .speed-submenu-container{display:flex;flex-direction:column;gap:8px;}
        .speed-hotkeys-row{flex-direction:column!important;align-items:stretch!important;gap:6px;}
        .speed-hotkeys-info{display:flex;flex-direction:column;gap:4px;}
        .speed-hotkeys-fields{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-top:12px;width:100%;}
        .speed-hotkey-field{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;color:var(--yt-text-secondary);flex:1;min-width:80px;}
        .speed-hotkey-field span{text-align:center;width:100%;}
        .speed-hotkey-input{width:100%;height:36px;border-radius:8px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);color:var(--yt-text-primary);text-align:center;text-transform:uppercase;}
        .speed-hotkey-input:focus{background:var(--yt-hover-bg);}
      `,
    'shorts-keyboard-styles': `
      .shorts-help-panel{position:fixed;top:50%;left:25%;transform:translate(-50%,-50%) scale(.9);z-index:10001;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s ease,transform .3s ease;width:340px;max-width:95vw;max-height:80vh;overflow:hidden;outline:none;color:var(--yt-text-primary,#fff);padding:14px;display:flex;flex-direction:column;gap:12px;}
      .shorts-help-panel.visible{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}
      .help-topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .help-header{margin:0;line-height:1.2;}
      .help-close{position:static;display:flex;align-items:center;justify-content:center;padding:4px;flex-shrink:0;}
      .help-body{display:flex;flex-direction:column;gap:12px;min-height:0;}
      .help-content{padding:8px 10px;max-height:400px;overflow-y:auto;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;border-radius:12px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);}
      .shorts-help-panel.is-dragging .help-content,.help-content:active{cursor:grabbing;}
      .help-item{display:flex;align-items:center;margin-bottom:14px;gap:18px;}
      .help-item kbd{background:var(--yt-shorts-kbd-bg);color:inherit;padding:7px 14px;border-radius:8px;font-family:monospace;font-size:15px;font-weight:700;min-width:60px;text-align:center;border:1.5px solid var(--yt-shorts-kbd-border);cursor:pointer;transition:background-color .2s cubic-bezier(0.2,0,0,1), transform .2s cubic-bezier(0.2,0,0,1), border-color .2s cubic-bezier(0.2,0,0,1);position:relative;}
      html[data-ytp-theme="light"] .help-item kbd,html:not([dark]):not([data-ytp-theme="dark"]) .help-item kbd{background:var(--yt-shorts-kbd-bg-light);color:#222;border:1.5px solid var(--yt-shorts-border-dark);}
      .help-item kbd:hover{background:var(--yt-shorts-kbd-hover);transform:scale(1.07);}
      .help-item kbd:not(.non-editable):active{transform:scale(0.96) !important;}
      .help-item kbd:after{content:"✎";position:absolute;top:-7px;right:-7px;font-size:11px;opacity:0;transition:opacity .2s;}
      .help-item kbd:hover:after{opacity:.7;}
      .help-item kbd.non-editable{cursor:default;opacity:.7;}
      .help-item kbd.non-editable:hover{background:var(--yt-shorts-kbd-bg);transform:none;}
      .help-item kbd.non-editable:after{display:none;}
      .help-item span{font-size:15px;color:var(--yt-shorts-text-secondary);}
      html[data-ytp-theme="light"] .help-item span,html:not([dark]):not([data-ytp-theme="dark"]) .help-item span{color:#222;}
      html[data-ytp-theme="light"] .shorts-help-panel,html:not([dark]):not([data-ytp-theme="dark"]) .shorts-help-panel{color:var(--yt-text-dark-primary,#222);}
      .help-actions{display:flex;justify-content:flex-end;align-items:center;}
      .reset-all-shortcuts{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
      .ytp-plus-shorts-download{width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;z-index:1;cursor:pointer;box-shadow:var(--yt-glass-shadow);background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);margin:0 auto 10px;align-self:center;color:var(--yt-text-primary);transition:background-color .3s cubic-bezier(0.2,0,0,1), color .3s cubic-bezier(0.2,0,0,1), border-color .3s cubic-bezier(0.2,0,0,1), transform .15s cubic-bezier(0.2,0,0,1), box-shadow .3s cubic-bezier(0.2,0,0,1);}
      .ytp-plus-shorts-download:active{transform:scale(0.96) !important;}
      .ytp-plus-shorts-download svg{width:22px;height:22px;display:block;pointer-events:none;}
      .ytp-plus-shorts-download:hover{background:var(--yt-glass-border);}
      .shortcut-edit-dialog{z-index:10002;}
      .shortcut-edit-content{padding:28px 32px;min-width:320px;text-align:center;display:flex;flex-direction:column;gap:var(--yt-space-md);color:inherit;}
      html[data-ytp-theme="light"] .shortcut-edit-content,html:not([dark]):not([data-ytp-theme="dark"]) .shortcut-edit-content{color:#222;}
      .shortcut-edit-content h4{margin:0 0 14px;font-size:17px;font-weight:700;}
      .shortcut-edit-content p{margin:0 0 18px;font-size:15px;color:rgba(255,255,255,.85);}
      html[data-ytp-theme="light"] .shortcut-edit-content p,html:not([dark]):not([data-ytp-theme="dark"]) .shortcut-edit-content p{color:#222;}
      .current-shortcut{margin:18px 0;font-size:15px;}
      .current-shortcut kbd{background:var(--yt-shorts-kbd-bg);padding:5px 12px;border-radius:6px;font-family:monospace;border:1.5px solid var(--yt-shorts-kbd-border);}
      html[data-ytp-theme="light"] .current-shortcut kbd,html:not([dark]):not([data-ytp-theme="dark"]) .current-shortcut kbd{background:var(--yt-shorts-kbd-bg-light);color:#222;border:1.5px solid var(--yt-shorts-border-dark);}
      .shortcut-cancel{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
      @media(max-width:480px){.shorts-help-panel{width:98vw;max-height:85vh;padding:10px}.help-content{padding:10px 8px}.help-item{gap:10px}.help-item kbd{min-width:44px;font-size:13px;padding:5px 7px}.ytp-plus-shorts-download{width:44px;height:44px;margin-bottom:8px}.shortcut-edit-content{margin:20px;min-width:auto}}
      #shorts-keyboard-feedback{background:var(--yt-shorts-feedback-bg-dark);color:var(--yt-text-primary,#fff);border:1.5px solid var(--yt-shorts-feedback-bg);border-radius:20px;box-shadow:0 8px 32px 0 var(--yt-shorts-shadow-blue);backdrop-filter:blur(12px) saturate(180%);-webkit-backdrop-filter:blur(12px) saturate(180%);}
      html[data-ytp-theme="light"] #shorts-keyboard-feedback,html:not([dark]):not([data-ytp-theme="dark"]) #shorts-keyboard-feedback{background:var(--yt-shorts-feedback-bg-light);color:var(--yt-text-dark-primary,#222);border:1.5px solid var(--yt-shorts-border-dark);}
    `,
    'pip-styles': `
      .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; }
      .pip-hidden-select { display: none; }
      .pip-submenu-layout { margin-left: 12px; margin-bottom: 12px; }
      .pip-submenu-layout.is-hidden { display: none; }
      .pip-submenu-card { display: flex; flex-direction: column; gap: 8px; }
      .pip-shortcut-item { display: flex; }
      .pip-submenu-toggle-hidden { display: none; }
      .pip-shortcut-editor select, .pip-key-input {background: rgba(34, 34, 34, var(--yt-header-bg-opacity)); color: var(--yt-spec-text-primary); border: 1px solid var(--yt-spec-10-percent-layer); border-radius: var(--yt-radius-sm); padding: 4px;}
      .pip-key-input { width: 35px; text-align: center; }
    `,
    'timecode-panel-styles': `
      html[dark],html[data-ytp-theme="dark"],body[dark]{--yt-timecode-panel-bg:var(--yt-timecode-panel-bg-dark);--yt-timecode-panel-border:var(--yt-timecode-panel-border-dark);--yt-timecode-panel-color:var(--yt-timecode-panel-color-dark)}
      html[light],html[data-ytp-theme="light"],html:not([dark]):not([data-ytp-theme="dark"]),body:not([dark]){--yt-timecode-panel-bg:var(--yt-timecode-panel-bg-light);--yt-timecode-panel-border:var(--yt-timecode-panel-border-light);--yt-timecode-panel-color:var(--yt-timecode-panel-color-light)}
      #timecode-panel{position:fixed;right:20px;top:80px;background:var(--yt-timecode-panel-bg);border-radius:16px;box-shadow:0 12px 40px var(--yt-timecode-panel-shadow);width:320px;max-height:70vh;z-index:10000;color:var(--yt-timecode-panel-color);backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);border:1.5px solid var(--yt-timecode-panel-border);transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .28s;overflow:hidden;display:flex;flex-direction:column}
      #timecode-panel.hidden{transform:translateX(300px);opacity:0;pointer-events:none}
      #timecode-panel.auto-tracking{box-shadow:0 12px 48px var(--yt-danger-ghost);border-color:var(--yt-danger-border)}
      #timecode-header{display:flex;justify-content:space-between;align-items:center;padding:14px;border-bottom:1px solid var(--yt-surface-overlay-subtle);background:linear-gradient(180deg, var(--yt-surface-overlay-faint), transparent);cursor:move}
      #timecode-title{font-weight:600;margin:0;font-size:15px;user-select:none;display:flex;align-items:center;gap:8px}
      #timecode-tracking-indicator{width:8px;height:8px;background:var(--yt-accent);border-radius:50%;opacity:0;transition:opacity .3s}
      #timecode-panel.auto-tracking #timecode-tracking-indicator{opacity:1}
      #timecode-current-time{font-family:monospace;font-size:12px;padding:2px 6px;background:var(--yt-danger-border);border-radius:3px;margin-left:auto}
      #timecode-header-controls{display:flex;align-items:center;gap:6px}
      #timecode-reload,#timecode-close{background:transparent;border:none;color:inherit;cursor:pointer;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .18s,color .18s}
      #timecode-header-controls svg{width:16px;height:16px;display:block;flex-shrink:0}
      #timecode-header-controls svg path{vector-effect:non-scaling-stroke}
      #timecode-reload:hover,#timecode-close:hover{background:var(--yt-surface-overlay-subtle)}
      #timecode-reload.loading{animation:spin .8s linear infinite}
      #timecode-list{overflow-y:auto;padding:8px 0;max-height:calc(70vh - 80px);scrollbar-width:thin;scrollbar-color:var(--yt-scrollbar-outline) transparent}
      #timecode-list::-webkit-scrollbar{width:6px}
      #timecode-list::-webkit-scrollbar-thumb{background:var(--yt-scrollbar-outline);border-radius:3px}
      .timecode-item{padding:10px 14px;display:flex;align-items:center;cursor:pointer;transition:background-color .16s,transform .12s;border-left:3px solid transparent;position:relative;border-radius:8px;margin:6px 10px}
      .timecode-item:hover{background:var(--yt-surface-overlay-subtle);transform:translateY(-2px)}
      .timecode-item:hover .timecode-actions{opacity:1}
      .timecode-item.active{background:linear-gradient(90deg, var(--yt-timecode-active-bg-start), var(--yt-timecode-active-bg-end));border-left-color:var(--yt-timecode-active-border);box-shadow:inset 0 0 0 1px var(--yt-timecode-active-inset)}
      .timecode-item.active.pulse{animation:timecodePulse .8s ease-out}
      .timecode-item.editing{background:linear-gradient(90deg, var(--yt-warning-soft), var(--yt-panel-overlay-weak));border-left-color:var(--yt-warning)}
      .timecode-item.editing .timecode-actions{opacity:1}
      @keyframes timecodePulse{0%{transform:scale(1)}50%{transform:scale(1.02)}100%{transform:scale(1)}}
      .timecode-time{font-family:monospace;margin-right:10px;color:var(--yt-text-secondary);font-size:13px;min-width:45px;flex-shrink:0}
      .timecode-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;flex:1;margin-left:4px}
      .timecode-item:not(:has(.timecode-label)) .timecode-time{flex:1;text-align:left}
      .timecode-item.has-chapter .timecode-time{color:var(--yt-timecode-chapter)}
      .timecode-progress{width:0;height:2px;background:var(--yt-timecode-chapter);position:absolute;bottom:0;left:0;transition:width .3s;opacity:.8}
      .timecode-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:4px;opacity:0;transition:opacity .2s;background:var(--yt-overlay-strong);border-radius:4px;padding:2px}
      .timecode-action{background:none;border:none;color:var(--yt-text-secondary);cursor:pointer;padding:4px;font-size:12px;border-radius:2px;transition:color .2s,background-color .2s}
      .timecode-action:hover{color:var(--yt-text-primary);background:var(--yt-button-bg)}
      .timecode-action.edit:hover{color:var(--yt-warning)}
      .timecode-action.delete:hover{color:var(--yt-timecode-chapter)}
      #timecode-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;text-align:center;color:var(--yt-text-secondary);font-size:13px}
      #timecode-form{padding:12px;border-top:1px solid var(--yt-surface-overlay-subtle);display:none}
      #timecode-form.visible{display:block}
      #timecode-form input{width:100%;margin-bottom:8px;padding:8px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);border-radius:4px;color:var(--yt-text-primary);font-size:13px}
      #timecode-form input::placeholder{color:var(--yt-text-secondary)}
      #timecode-form-buttons{display:flex;gap:8px;justify-content:flex-end}
      #timecode-form-buttons button{padding:6px 12px;border:none;border-radius:4px;cursor:pointer;font-size:12px;transition:background-color .2s}
      #timecode-form-cancel{background:var(--yt-button-bg);color:var(--yt-text-primary)}
      #timecode-form-cancel:hover{background:var(--yt-hover-bg)}
      #timecode-form-save{background:var(--yt-timecode-chapter);color:var(--yt-text-primary)}
      #timecode-form-save:hover{background:var(--yt-timecode-active-border)}
      #timecode-actions{padding:10px;border-top:1px solid var(--yt-surface-overlay-subtle);display:flex;gap:8px;background:linear-gradient(180deg,transparent,var(--yt-panel-overlay-subtle))}
      #timecode-actions button{padding:8px 12px;border:none;border-radius:8px;cursor:pointer;font-size:13px;transition:background .18s;color:inherit;background:var(--yt-surface-overlay-faint)}
      #timecode-export-btn.is-hidden{display:none}
      #timecode-actions button:hover{background:var(--yt-surface-overlay-subtle)}
      #timecode-track-toggle.active{background:linear-gradient(90deg,var(--yt-timecode-toggle-active-start),var(--yt-timecode-chapter));color:var(--yt-text-primary)}
      #timecode-empty .timecode-empty-hint{margin-top:5px;font-size:12px}
      .timecode-submenu-layout{margin-left:12px;margin-bottom:12px}
      .timecode-submenu-layout.is-hidden{display:none}
      .timecode-submenu-card{display:flex;flex-direction:column;gap:8px}
      .timecode-shortcut-row{display:flex}
      .timecode-shortcut-editor{display:flex;align-items:center;gap:8px}
      .timecode-hidden-select{display:none}
      .timecode-submenu-toggle-hidden{display:none}
      .timecode-shortcut-plus{color:inherit;opacity:.8}
      .timecode-key-input{width:35px;text-align:center;background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-border-color);border-radius:4px;padding:4px}
    `,
    'thumbnail-viewer-styles': `
        .thumbnail-player-overlay{position:absolute;top:10%;right:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;z-index:1001;transition:opacity 0.15s ease, background-color 0.15s ease, transform 0.1s cubic-bezier(0.2,0,0,1);opacity:0}
        .thumbnail-player-overlay:active{transform:scale(0.96) !important;}
        .thumbnail-base-overlay{position:absolute;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1000;opacity:0;transition:opacity 0.2s ease, background-color 0.2s ease, transform 0.1s cubic-bezier(0.2,0,0,1)}
        .thumbnail-base-overlay:active{transform:scale(0.96) !important;}
        .thumb-overlay,.banner-overlay{bottom:8px;left:8px;border-radius:4px}
        .thumb-overlay{background:var(--yt-thumbnail-overlay-idle)}
        .thumb-overlay:hover{background:var(--yt-thumbnail-overlay-hover)}
        .avatar-overlay{top:50%;left:50%;transform:translate(-50%, -50%);border-radius:50%;background:var(--yt-thumbnail-overlay-hover)}
        .avatar-overlay:hover{background:var(--yt-thumbnail-overlay-active)}
        .banner-overlay{background:var(--yt-thumbnail-overlay-hover)}
        .banner-overlay:hover{background:var(--yt-thumbnail-overlay-active)}
        .thumbnail-overlay-container { position: absolute; bottom: 8px; left: 8px; z-index: var(--yt-z-overlay); opacity: 0; transition: opacity 0.2s ease; }
        .thumbnail-overlay-button { width: 28px; height: 28px; background: var(--yt-glass-bg); border: none; border-radius: var(--yt-radius-xs); cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--yt-text-primary); position: relative; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-overlay-button svg{width:16px;height:16px;display:block;flex:none;}
        .thumbnail-overlay-button:hover { background: var(--yt-hover-bg); }
        .thumbnail-dropdown { position: absolute; bottom: 100%; left: 0; background: var(--yt-glass-bg); border-radius: var(--yt-radius-xs); padding: 4px; margin-bottom: 4px; display: none; flex-direction: column; min-width: 140px; box-shadow: var(--yt-glass-shadow); z-index: var(--yt-z-flyout); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-dropdown.show { display: flex !important; }
        .thumbnail-dropdown-item { background: none; border: none; color: var(--yt-text-primary); padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 12px; text-align: left; white-space: nowrap; transition: background-color 0.2s ease; }
        .thumbnail-dropdown-item:hover { background: var(--yt-hover-bg); }
        .thumbnailPreview-button { position: absolute; bottom: 10px; left: 5px; background-color: var(--yt-glass-bg); color: var(--yt-text-primary); border: none; border-radius: var(--yt-radius-xs); padding: 3px; font-size: 18px; cursor: pointer; z-index: var(--yt-z-overlay); opacity: 0; transition: opacity 0.3s; display: flex; align-items: center; justify-content: center; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnailPreview-button svg{width:16px;height:16px;display:block;flex:none;}
        .thumbnailPreview-container { position: relative; }
        .thumbnailPreview-container:hover .thumbnailPreview-button { opacity: 1; }
        .thumbnail-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--yt-modal-bg); z-index: var(--yt-z-modal); display: flex; align-items: center; justify-content: center; animation: fadeInModal 0.22s cubic-bezier(.4,0,.2,1); backdrop-filter: blur(8px) saturate(140%); -webkit-backdrop-filter: blur(8px) saturate(140%); }
        .thumbnail-modal-content { background: var(--yt-glass-bg); border-radius: var(--yt-radius-lg); box-shadow: 0 12px 40px var(--yt-timecode-panel-shadow); max-width: 78vw; max-height: 90vh; overflow: auto; position: relative; display: flex; flex-direction: column; align-items: center; animation: scaleInModal 0.22s cubic-bezier(.4,0,.2,1); border: 1.5px solid var(--yt-glass-border); backdrop-filter: blur(14px) saturate(150%); -webkit-backdrop-filter: blur(14px) saturate(150%);}
        .thumbnail-modal-wrapper { display: flex; align-items: flex-start; gap: 12px; }
        .thumbnail-modal-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
        .thumbnail-modal-action-btn { padding: 0; line-height: 0; }
        .thumbnail-modal-action-btn svg{width:18px;height:18px;display:block;flex:none;}
        .thumbnail-modal-close svg{width:36px;height:36px;}
        .thumbnail-modal-img { max-width: 72vw; max-height: 70vh; box-shadow: var(--yt-glass-shadow); background: #222; border: 1px solid var(--yt-glass-border); }
        .thumbnail-modal-options { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
        .thumbnail-modal-option-btn { background: var(--yt-button-bg); color: var(--yt-text-primary); border: none; border-radius: var(--yt-radius-xs); padding: 8px 18px; font-size: 14px; cursor: pointer; transition: background 0.2s,color .2s; margin-bottom: 6px; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); border: 1px solid var(--yt-glass-border); }
        .thumbnail-modal-option-btn:hover { background: var(--yt-hover-bg); color: var(--yt-accent); }
        .thumbnail-modal-title { font-size: 18px; font-weight: 600; color: var(--yt-text-primary); margin-bottom: 10px; text-align: center; text-shadow: 0 2px 8px var(--yt-shadow-deep-1); }
    `,
    'ytp-resume-overlay-styles': `
      .ytp-resume-overlay{min-width:180px;max-width:36vw;background:var(--yt-glass-bg);color:var(--yt-text-primary,#fff);padding:12px 14px;border-radius:12px;backdrop-filter:blur(8px) saturate(150%);-webkit-backdrop-filter:blur(8px) saturate(150%);box-shadow:0 14px 40px var(--yt-shadow-flyout);border:1.25px solid var(--yt-surface-overlay-border);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;text-align:center;animation:ytp-resume-fadein 0.3s ease-out}
      @keyframes ytp-resume-fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      .ytp-resume-overlay .ytp-resume-title{font-weight:600;margin-bottom:8px;font-size:13px}
      .ytp-resume-overlay .ytp-resume-btn{padding:6px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:500;transition:background-color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), box-shadow 0.2s cubic-bezier(0.2,0,0,1);outline:none}
      .ytp-resume-overlay .ytp-resume-btn:focus{box-shadow:0 0 0 2px var(--yt-glass-border);outline:2px solid transparent}
      .ytp-resume-overlay .ytp-resume-btn:hover{transform:translateY(-1px)}
      .ytp-resume-overlay .ytp-resume-btn:active{transform:scale(0.96) !important;}
      .ytp-resume-overlay .ytp-resume-btn.primary{background:var(--yt-accent-secondary);color:#fff}
      .ytp-resume-overlay .ytp-resume-btn.primary:hover{background:var(--yt-accent-secondary-light)}
      .ytp-resume-overlay .ytp-resume-btn.ghost{background:var(--yt-button-bg);color:var(--yt-text-primary)}
      .ytp-resume-overlay .ytp-resume-btn.ghost:hover{background:var(--yt-hover-bg)}
    `,
    'ytp-plus-comments-modal-style': `
        .ytp-plus-comments-sidepanel{position:fixed;top:10vh;left:calc(50% + 390px);width:min(440px,34vw);max-width:92vw;height:60vh;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:24px;display:none;z-index:100001;box-shadow:0 12px 40px var(--yt-timecode-panel-shadow);overflow:hidden;backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);contain:layout style paint;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
        .ytp-plus-comments-sidepanel.open{display:flex;flex-direction:column}
        .ytp-plus-comments-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--yt-stats-card-border-dark)}
        .ytp-plus-comments-title{font-size:16px;font-weight:500;color:var(--yt-text-primary);font-family:inherit}
        .ytp-plus-comments-close{border:0;background:transparent;color:var(--yt-text-secondary);font-size:24px;cursor:pointer;line-height:1}
        .ytp-plus-comments-list{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:10px}
        .ytp-plus-comments-item{border:1px solid var(--yt-stats-card-border-dark);background:var(--yt-surface-overlay-faint);border-radius:10px;padding:10px}
        .ytp-plus-comments-item-text{color:var(--yt-text-primary);white-space:pre-wrap;word-break:break-word;font-size:small}
        .ytp-plus-comments-item-meta{margin-top:6px;color:var(--yt-text-secondary);font-size:12px}
        .ytp-plus-comments-form{padding:12px 16px;border-top:1px solid var(--yt-stats-card-border-dark);display:flex;gap:8px;align-items:center}
        #ytp-plus-comments-input{flex:1;min-height:15px;max-height:160px;resize:vertical;background:var(--yt-glass-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:10px;padding:10px}
        #ytp-plus-comments-submit{border:1px solid var(--yt-glass-border);background:var(--yt-accent);color:var(--yt-text-primary);border-radius:10px;padding:10px 14px;cursor:pointer}
        .ytp-plus-voting-item-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
        .ytp-plus-voting-comments-icon{border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-secondary);border-radius:999px;min-width:28px;height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;transition:background-color .2s ease,color .2s ease,border-color .2s ease}
        .ytp-plus-voting-comments-icon:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary)}
        .ytp-plus-voting-comments-icon svg{width:14px;height:14px;display:block;fill:currentColor}
        .ytp-plus-comments-sidepanel textarea,
        .ytp-plus-comments-sidepanel button,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item-text,
        .ytp-plus-comments-sidepanel .ytp-plus-comments-item-meta,
        .ytp-plus-comments-sidepanel .ytp-plus-voting-empty{font-family:inherit}
    `,
    'ytplus-playlist-delete-styles': `
      .ytplus-playlist-search { padding: 8px 16px; background: transparent; border-bottom: 1px solid var(--yt-spec-10-percent-layer); z-index: 50; width: 94%; }
      .ytplus-playlist-search-input { width: 93%; padding: 8px 16px; border: 1px solid var(--yt-spec-10-percent-layer); border-radius: 20px; background: var(--yt-spec-badge-chip-background); color: var(--yt-text-primary); font-size: 14px; font-family: 'Roboto', Arial, sans-serif; outline: none; transition: border-color 0.2s; }
      .ytplus-playlist-search-input.is-focused { border-color: var(--yt-spec-call-to-action); }
      .ytplus-playlist-input-row { display: flex; align-items: center; gap: 6px; }
      .ytplus-playlist-input-row .ytplus-playlist-search-input { width: auto; flex: 1; }
      .ytplus-playlist-delete-toggle { background: transparent; border: 1px solid var(--yt-spec-10-percent-layer); border-radius: 50%; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--yt-spec-text-secondary); transition: background-color 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1); vertical-align: middle; margin-left: 6px; flex-shrink: 0; }
      .ytplus-playlist-delete-toggle:active { transform: scale(0.96) !important; }
      .ytplus-playlist-delete-toggle:hover { color: var(--yt-spec-text-primary); border-color: var(--yt-spec-text-secondary); }
      .ytplus-playlist-delete-bar { display: none; padding: 6px 0 0; gap: 8px; align-items: center; flex-wrap: wrap; }
      .ytplus-playlist-delete-bar.is-visible { display: flex; }
      .ytplus-playlist-selected-count { font-size: 12px; color: var(--yt-spec-text-secondary); margin-right: auto; }
      .ytplus-playlist-delete-action { padding: 5px 12px; border-radius: 16px; border: 1px solid var(--yt-spec-10-percent-layer); cursor: pointer; font-size: 12px; font-weight: 500; background: var(--yt-spec-badge-chip-background); color: var(--yt-spec-text-primary); transition: background-color 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1); }
      .ytplus-playlist-delete-action:active { transform: scale(0.96) !important; }
      .ytplus-playlist-delete-selected { background: var(--yt-search-highlight-bg); border-color: var(--yt-search-highlight-border); color: var(--yt-search-highlight-accent); }
      .ytplus-playlist-delete-selected:disabled { opacity: 0.5; }
      .ytplus-playlist-delete-selected:not(:disabled):hover { background: var(--yt-search-highlight-hover) !important; }
      .ytplus-playlist-select-all:hover, .ytplus-playlist-clear-all:hover { background: var(--yt-spec-10-percent-layer) !important; }
      .ytplus-playlist-item-checkbox { position: absolute; top: 8px; left: 8px; z-index: 2; cursor: pointer; opacity: 0.85; transition: opacity 0.15s; }
      .ytplus-playlist-item-checkbox:hover { opacity: 1; }
    `,
    'ytp-download-styles': `
      .ytp-download-button{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;cursor:pointer!important;}
      .download-options{position:fixed;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yt-radius-md);width:150px;z-index:2147483647;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);overflow:hidden;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;transform:translateY(8px);box-sizing:border-box;}
      .download-options.visible{opacity:1;pointer-events:auto;transform:translateY(0);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
      .download-options-list{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;}
      .download-option-item{cursor:pointer;padding:12px;text-align:center;transition:background .2s,color .2s;width:100%;}
      .download-option-item:hover{background:var(--yt-hover-bg);color:var(--yt-accent);}
      .download-submenu{margin:4px 0 12px 12px;}
      .download-submenu-container{display:flex;flex-direction:column;gap:8px;}
      .download-site-option{display:flex;flex-direction:column;gap:8px;}
      .download-site-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
      .download-site-label{display:flex;flex-direction:column;gap:2px;cursor:pointer;}
      .download-site-name{font-size:13px;font-weight:600;color:var(--yt-text-primary);}
      .download-site-desc{font-size:12px;color:var(--yt-text-secondary);}
      .download-site-controls{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
      .download-site-input{width:100%;height:36px;border-radius:8px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:0 10px;box-sizing:border-box;}
      .download-site-input.small{height:32px;font-size:12px;}
      .download-site-input:focus{background:var(--yt-hover-bg);outline:none;}
      .download-site-cta{display:flex;gap:8px;flex-wrap:wrap;}
      .download-site-cta.one-btn{justify-content:flex-start;}
    `,
    'ytp-enhanced-styles': `
      :root{--yt-scrollbar-width:8px;--yt-scrollbar-track:transparent;--yt-scrollbar-thumb:rgba(144,144,144,.5);--yt-scrollbar-thumb-hover:rgba(170,170,170,.7);--yt-scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--yt-scrollbar-width)!important;height:var(--yt-scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--yt-scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--yt-scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--yt-scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--yt-scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      html,body,#content,#guide-content,#secondary,#comments,#chat,ytd-comments,ytd-watch-flexy,ytd-browse,ytd-search,ytd-playlist-panel-renderer,#right-tabs,.tab-content-cld,ytmusic-app-layout{scrollbar-width:thin;scrollbar-color:var(--yt-scrollbar-thumb) var(--yt-scrollbar-track);}
      html[dark],html[data-ytp-theme="dark"]{--yt-scrollbar-thumb:rgba(144,144,144,.4);--yt-scrollbar-thumb-hover:rgba(170,170,170,.6);--yt-scrollbar-thumb-active:rgba(190,190,190,.8);}
      html[light],html[data-ytp-theme="light"],html:not([dark]):not([data-ytp-theme="dark"]){--yt-scrollbar-thumb:rgba(60,60,60,.35);--yt-scrollbar-thumb-hover:rgba(60,60,60,.55);--yt-scrollbar-thumb-active:rgba(40,40,40,.75);}
      .top-button{position:fixed;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-button-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2100;opacity:0;visibility:hidden;transition:opacity .3s cubic-bezier(0.2,0,0,1), visibility .3s cubic-bezier(0.2,0,0,1), background-color .3s cubic-bezier(0.2,0,0,1), transform .15s cubic-bezier(0.2,0,0,1), box-shadow .3s cubic-bezier(0.2,0,0,1), border-color .3s cubic-bezier(0.2,0,0,1);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-shadow);}
      .top-button:hover{background:var(--yt-hover-bg);transform:translateY(-2px) scale(1.07);box-shadow:var(--yt-shadow);}
      .top-button:active{transform:scale(0.96) !important;}
      .top-button:focus{outline:2px solid var(--yt-accent);outline-offset:2px;}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s ease;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark],html[data-ytp-theme="dark"]{--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      html[data-ytp-theme="light"],html:not([dark]):not([data-ytp-theme="dark"]){--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      #right-tabs .top-button{position:absolute;z-index:1000;}
      ytd-watch-flexy:not([tyt-tab^="#"]) #right-tabs .top-button{display:none;}
      ytd-playlist-panel-renderer .top-button{position:absolute;z-index:1000;}
      ytd-watch-flexy[flexy] #movie_player, ytd-watch-flexy[flexy] #movie_player .html5-video-container, ytd-watch-flexy[flexy] .html5-main-video{width:100%!important; max-width:100%!important;}
      ytd-watch-flexy[flexy] .html5-main-video{height:auto!important; max-height:100%!important; object-fit:contain!important; transform:none!important;}
      ytd-watch-flexy[flexy] #player-container-outer, ytd-watch-flexy[flexy] #movie_player{display:flex!important; align-items:center!important; justify-content:center!important;}
      dislike-button-view-model,
      ytd-toggle-button-renderer,
      yt-button-shape,
      ytd-segmented-like-dislike-button-renderer{min-width:fit-content!important;width:auto!important;}
      dislike-button-view-model button{min-width:fit-content!important;width:auto!important;}
      dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;align-items:center!important;justify-content:center!important;}
      #ytp-plus-dislike-text{display:inline-block!important;visibility:visible!important;opacity:1!important;}
      #ytp-plus-dislike-text.ytp-plus-dislike-text--regular{margin-left:6px!important;font-size:1.4rem!important;line-height:2rem!important;font-weight:500!important;min-width:2em!important;text-align:center!important;}
      #ytp-plus-dislike-text.ytp-plus-dislike-text--shorts{margin-left:4px!important;font-size:1.2rem!important;line-height:1.8rem!important;font-weight:500!important;min-width:1.5em!important;text-align:center!important;}
      ytd-segmented-like-dislike-button-renderer dislike-button-view-model button{min-width:fit-content!important;}
      ytd-segmented-like-dislike-button-renderer .yt-spec-button-shape-next__button-text-content{min-width:2.4rem!important;}
      ytd-reel-video-renderer dislike-button-view-model #ytp-plus-dislike-text.ytp-plus-dislike-text--shorts{font-size:1.2rem!important;line-height:1.8rem!important;margin-left:4px!important;}
      ytd-reel-video-renderer dislike-button-view-model button{padding:8px 12px!important;min-width:auto!important;}
      ytd-shorts dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;min-width:auto!important;}
    `,
    'ytp-play-all-styles': `.ytp-play-all-btn{display:inline-flex;align-items:center;padding:0 12px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--yt-playall-accent-purple),var(--yt-playall-accent-blue));color:#fff;font-size:1.4rem;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;flex-shrink:0;user-select:none;font-family:Roboto,Arial,sans-serif;letter-spacing:.007em;line-height:1;vertical-align:middle;border:none;outline:none}.ytp-play-all-btn:hover{opacity:.85}
.ytp-play-all-parent{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ytp-play-all-parent>chip-bar-view-model.ytChipBarViewModelHost{flex:1 1 auto;min-width:0}
 .ytp-random-badge-close{font-size:2rem;vertical-align:top;line-height:1;display:inline-block;}`,
    'ytp-stats-styles': `.ytp-stats-btn{display:flex;align-items:center;justify-content:center;gap:8px}
.ytp-stats-icon{width:20px;height:20px;fill:currentColor}
.ytp-stats-btn-text{display:flex;align-items:center}
.ytp-stats-touch-feedback{border-radius:inherit}
.ytp-stats-channel-menu{display:flex;gap:15px;width:360px}
.ytp-stats-display-label{display:block;margin-bottom:10px;font-size:16px;font-weight:bold}
.ytp-stats-font-label{font-size:16px;font-weight:bold}
.ytp-stats-font-value{font-size:14px;margin-bottom:15px}
.ytp-stats-spinner{position:absolute;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.ytp-stats-change-positive{color:#1ed760}
.ytp-stats-change-negative{color:#f3727f}`,
    'ytp-music-fab-styles': `.ytp-music-fab-side-panel{position:absolute!important;bottom:20px!important;right:20px!important;z-index:1200!important;pointer-events:auto!important;display:flex}
.ytp-music-fab{position:fixed;bottom:100px;right:20px;z-index:10000;pointer-events:auto;display:flex}`,
  };

  /**
   * Look up a registered static stylesheet by id.
   * @param {string} id
   * @returns {string} CSS text, or '' when no bundle is registered for the id.
   */
  const getStyle = id =>
    typeof id === 'string' && Object.hasOwn(STYLE_BUNDLES, id)
      ? /** @type {Record<string, string>} */ (STYLE_BUNDLES)[id]
      : '';

  // Bootstrap only presentation-safe static UI bundles up front so
  // on-demand widgets never render in an unstyled state before their
  // module-level init path gets a chance to call getStyle(...)+add(...).
  // Intentionally exclude behavior-changing/global bundles like
  // `ytp-enhanced-styles` because those are
  // still owned by their feature flags and runtime init paths.
  const BOOTSTRAP_STYLE_BUNDLE_IDS = [
    'ytp-screenshot-styles',
    'ytp-speedcontrol-styles',
    'shorts-keyboard-styles',
    'pip-styles',
    'timecode-panel-styles',
    'thumbnail-viewer-styles',
    'ytp-resume-overlay-styles',
    'ytp-plus-comments-modal-style',
    'ytplus-playlist-delete-styles',
    'ytp-download-styles',
    'ytp-play-all-styles',
    'ytp-stats-styles',
    'ytp-music-fab-styles',
  ];

  /**
   * Bootstrap all presentation-safe static CSS bundles into the StyleManager.
   * Called on init, DOMContentLoaded, and SPA navigation events.
   */
  const bootstrapStaticStyles = () => {
    try {
      const styleManager = window.YouTubePlusDesignSystem?.StyleManager;
      if (!styleManager || typeof styleManager.add !== 'function') return;
      for (const id of BOOTSTRAP_STYLE_BUNDLE_IDS) {
        const css = getStyle(id);
        if (!css) continue;
        styleManager.add(id, css);
      }
    } catch (error) {
      try {
        const logger = window.YouTubePlusLogger || window.YouTubeUtils?.logger || null;
        logger?.warn?.('design-system', 'Failed to bootstrap static style bundles', error);
      } catch {
        // Non-critical bootstrap path.
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      ...(window.YouTubePlusDesignSystem || {}),
      styleBundles: STYLE_BUNDLES,
      getStyle,
      bootstrapStyleBundleIds: BOOTSTRAP_STYLE_BUNDLE_IDS,
      bootstrapStaticStyles,
    };
    bootstrapStaticStyles();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrapStaticStyles, {
        once: true,
      });
    }
    window.addEventListener('yt-navigate-finish', bootstrapStaticStyles, {
      passive: true,
    });

    // ---------------------------------------------------------------------------
    // Back-compat shim for settings-modal UI widget helpers.
    // Canonical home: src/modal-handlers.js -> window.YouTubePlusModalHandlers.
    // Expose these as lazy getters on the final YouTubePlusDesignSystem object
    // so they are not evaluated or flattened into simple 'undefined' values
    // during the object spread / assignment above.
    // ---------------------------------------------------------------------------
    const WIDGET_BRIDGE_KEYS = [
      'modifierComboValues',
      'resolveModifierComboValue',
      'formatModifierComboLabel',
      'buildModifierComboOptionItems',
      'buildModifierComboDropdownItems',
      'initGlassDropdown',
    ];
    for (const key of WIDGET_BRIDGE_KEYS) {
      if (window.YouTubePlusDesignSystem[key] !== undefined) continue;
      try {
        Object.defineProperty(window.YouTubePlusDesignSystem, key, {
          configurable: true,
          enumerable: true,
          get() {
            const mh = typeof window !== 'undefined' ? window.YouTubePlusModalHandlers : null;
            if (!mh) return undefined;
            const value = mh[key];
            return typeof value === 'function' ? value.bind(mh) : value;
          },
        });
      } catch {
        // Property may be non-configurable on test mocks.
      }
    }

    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusDesignSystem = window.YouTubePlusDesignSystem;
    }
    if (window.YouTubePlusDesignSystem) {
      if (window.YouTubePlusDesignSystem.StyleManager) {
        Object.freeze(window.YouTubePlusDesignSystem.StyleManager);
      }
      Object.freeze(window.YouTubePlusDesignSystem);
    }
  }
})();
