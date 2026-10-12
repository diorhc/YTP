/**
 * design-system.js: style / design-system module.
 *
 * Owns:
 *   - Theme variant & preference bootstrap: sets layout variant attributes and
 *     writes PREF cookie. CSS uses YouTube's native `html[dark]` / `html:not([dark])`.
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
 *       (has/get/size/ids/host) plus a single style host element, so
 *       modules keep only their logic and reference their CSS by id.
 *   - Design-system token CSS bundle (`yp-design-system`): CSS variables,
 *     shared component classes (`.yp-btn`, `.yp-panel`, etc.).
 *   - Central static-CSS registry: read-only lookup of static stylesheets by
 *     id via `getStyle(id)`. Dynamic CSS (settings-driven, runtime values)
 *     stays in its module.
 *
 * Back-compat shim only (do not use in new code):
 *   - Modifier-combo formatter/builder helpers
 *   - Glass dropdown initializer
 *   Home: src/modal-handlers.js -> window.YouTubePlusModalHandlers.
 *   Exposed here as a thin lazy delegating bridge.
 *
 * Module must remain dependency-free for userscript use.
 */
// @ts-check
/// ---------------------------------------------------------------------------
// Theme variant & preference bootstrap.
//
// YouTube uses a simple two-state model:
//   html[dark]        → dark theme
//   html (no attr)    → light theme (default)
//
// All CSS is written for light as the BASE. Dark overrides use html[dark].
//
// This IIFE handles:
//   1. Theme variant (Vision/Classic) and material style (Glass/Solid):
//      sets data-yp-variant and data-yp-style on <html>.
//   2. Theme preference (Device/Dark/Light):
//      - Device: don't touch anything, YouTube/OS decides.
//      - Dark:   PREF cookie f6=400 → YouTube renders dark natively.
//      - Light:  remove html[dark] if present + guard with observer so
//                YouTube's Polymer doesn't re-add it.
// ---------------------------------------------------------------------------
(function () {
  if (typeof document === 'undefined') return;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'DesignSystem');

  const html = typeof document !== 'undefined' ? document.documentElement : null;
  const THEME_FLAG = '__ytplusThemeSync';
  /** @type {Record<string, unknown>} */
  const win = /** @type {Record<string, unknown>} */ (typeof window !== 'undefined' ? window : {});
  if (win[THEME_FLAG]) return;
  win[THEME_FLAG] = true;

  // ---- Theme Preference (early read from localStorage) ----
  // Read preference from localStorage directly (NOT from YouTubeUtils which
  // may not be loaded yet). This ensures force-light works on first paint.
  const PREF_KEY = 'ytp-theme-preference';

  /** @type {'dark' | 'light' | 'device'} */
  let themePreference = 'device';

  const readThemePreferenceEarly = () => {
    try {
      // Primary: direct localStorage key (set by applyThemePreference)
      const direct = window.YouTubePlusSettingsStore?.readRaw?.(PREF_KEY);
      if (direct === 'dark' || direct === 'light' || direct === 'device') {
        themePreference = direct;
        return;
      }
      // Fallback: read from SettingsStore or raw main settings object (supports migrated styles and legacy zenStyles)
      const storePref = window.YouTubePlusSettingsStore?.get?.('styles.themePreference');
      if (storePref === 'dark' || storePref === 'light' || storePref === 'device') {
        themePreference = storePref;
        return;
      }
      const raw = window.YouTubePlusSettingsStore?.readRaw?.('youtube_plus_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        const val = parsed?.styles?.themePreference ?? parsed?.zenStyles?.themePreference;
        if (val === 'dark' || val === 'light' || val === 'device') {
          themePreference = val;
          return;
        }
      }
    } catch (_err) {
      logS(_err);
    }
    themePreference = 'device';
  };

  // ---- Theme Variant ----

  /**
   * @typedef {{ themePreference?: 'dark' | 'light' | 'device', themeVariant?: 'glass' | 'solid' | 'vision' | 'classic' | 'minimal', themeStyle?: 'glass' | 'solid' }} StylesSettings
   * @typedef {{ styles?: StylesSettings }} YoutubePlusSettings
   */

  /** @type {'vision' | 'classic'} */
  let themeVariant = 'vision';
  /** @type {'glass' | 'solid'} */
  let themeStyle = 'glass';

  /**
   * Read a `styles` setting key from storage, validating against an
   * allowed-values list. Returns `fallback` on any parse failure, missing
   * key, or value outside the allowed set. Reads from SettingsStore first,
   * falling back to parsed storage (including legacy zenStyles).
   * @param {'themePreference'|'themeVariant'|'themeStyle'} key
   * @param {readonly string[]} allowed
   * @param {string} fallback
   * @returns {string}
   */
  const readStylesSetting = (key, allowed, fallback) => {
    try {
      const storeVal = window.YouTubePlusSettingsStore?.get?.(`styles.${key}`);
      if (typeof storeVal === 'string' && allowed.includes(storeVal)) return storeVal;

      const parsed = /** @type {YoutubePlusSettings | null} */ (
        window.YouTubeUtils?.storage?.get('youtube_plus_settings')
      );
      if (parsed && typeof parsed === 'object') {
        const value =
          parsed.styles?.[key] ??
          /** @type {{ styles?: Record<string, unknown>; zenStyles?: Record<string, unknown> }} */ (
            parsed
          ).zenStyles?.[key];
        if (typeof value === 'string' && allowed.includes(value)) return value;
      }
    } catch (_err) {
      logS(_err);
    }
    return fallback;
  };

  const readThemeVariant = () => {
    const rawVariant = readStylesSetting(
      'themeVariant',
      ['solid', 'classic', 'glass', 'vision'],
      'vision'
    );
    themeVariant = rawVariant === 'classic' || rawVariant === 'solid' ? 'classic' : 'vision';

    const rawStyle = readStylesSetting(
      'themeStyle',
      ['glass', 'solid'],
      rawVariant === 'solid' ? 'solid' : 'glass'
    );
    themeStyle = rawStyle === 'solid' ? 'solid' : 'glass';
  };

  /**
   * @param {string} [explicitVariant]
   * @param {string} [explicitStyle]
   */
  const applyThemeVariant = (explicitVariant, explicitStyle) => {
    if (explicitVariant) {
      themeVariant =
        explicitVariant === 'classic' || explicitVariant === 'solid' ? 'classic' : 'vision';
    }
    if (explicitStyle) {
      themeStyle = explicitStyle === 'solid' ? 'solid' : 'glass';
    }
    const docEl = html || (typeof document !== 'undefined' ? document.documentElement : null);
    if (docEl) {
      docEl.setAttribute('data-yp-variant', themeVariant);
      docEl.setAttribute('data-yp-style', themeStyle);
    }
  };

  // ---- Force Theme: directly manipulate [dark] attribute ----

  /** Guard flag to prevent re-entrant observer calls */
  let applyingTheme = false;

  /**
   * Enforce the chosen theme preference by adding/removing [dark] on ALL
   * elements that have it. YouTube sets `dark` not only on `<html>` but
   * also on `<ytd-app>`, `<body>`, popup containers, and other components.
   * We must remove it from all of them for a consistent light theme.
   */
  const enforceTheme = () => {
    if (applyingTheme) return;
    applyingTheme = true;
    const docEl = html || (typeof document !== 'undefined' ? document.documentElement : null);
    if (themePreference === 'light') {
      // Remove [dark] from html and all elements in the document
      docEl?.removeAttribute('dark');
      document.querySelectorAll('[dark]').forEach(el => el.removeAttribute('dark'));
    } else if (themePreference === 'dark') {
      // Ensure dark is set on html and ytd-app
      if (docEl && !docEl.hasAttribute('dark')) {
        docEl.setAttribute('dark', '');
      }
      const app = document.querySelector('ytd-app');
      if (app && !app.hasAttribute('dark')) {
        app.setAttribute('dark', '');
      }
    }
    // 'device': do nothing, let YouTube/OS handle it
    applyingTheme = false;
  };

  /**
   * YouTube хранит тему в поле `f6` cookie PREF: это ШЕСТНАДЦАТЕРИЧНАЯ
   * битовая маска, а не одно значение темы. Бит 0x400 означает тёмную тему;
   * остальные биты хранят другие настройки пользователя (в том числе признак
   * того, что тема выбрана явно, а не взята от системы).
   *
   * Раньше при выборе Light мы удаляли `f6` целиком. Для YouTube отсутствие
   * `f6` означает «использовать тему устройства», поэтому меню Appearance
   * переключалось на «Use device theme», а выбор пользователя стирался.
   * Теперь мы меняем только бит темы и сохраняем все прочие биты.
   */
  const YT_PREF_DARK_BIT = 0x400;

  /**
   * Бит «явно выбрана СВЕТЛАЯ тема». Проверено на живом YouTube 05.09.2026:
   *   f6 = <база> | 0x400    -> html[dark], тёмная
   *   f6 = <база> | 0x80000  -> html без [dark], светлая ДАЖЕ при тёмной теме ОС
   *   f6 = <база> без обоих  -> тема берётся от системы (меню: "Use device theme")
   * Именно поэтому раньше Light не работал: код просто удалял f6, а отсутствие
   * обоих битов для YouTube означает "device", а не "light".
   */
  const YT_PREF_LIGHT_BIT = 0x80000;

  /**
   * Прочитать текущее значение f6 из cookie PREF.
   * @returns {number|null} число, либо null если поля нет / оно не парсится
   */
  const readPrefF6 = () => {
    try {
      const prefMatch = document.cookie.match(/(?:^|;\s*)PREF=([^;]*)/);
      if (!prefMatch) return null;
      const f6Match = decodeURIComponent(prefMatch[1]).match(/(?:^|&)f6=([^&]*)/);
      if (!f6Match) return null;
      const parsed = Number.parseInt(f6Match[1], 16);
      return Number.isNaN(parsed) ? null : parsed;
    } catch (_err) {
      logS(_err);
      return null;
    }
  };

  /**
   * Write the YouTube PREF cookie with the given f6 value.
   * @param {string|null} f6Value
   */
  const writePrefCookie = f6Value => {
    try {
      let pref = '';
      const match = document.cookie.match(/(?:^|;\s*)PREF=([^;]*)/);
      if (match) pref = match[1];
      pref = pref.replace(/(?:^|&)f6=[^&]*/, '');
      pref = pref.replace(/^&+|&+$/g, '');
      if (f6Value !== null) {
        pref = pref ? `${pref}&f6=${f6Value}` : `f6=${f6Value}`;
      }
      // biome-ignore lint/suspicious/noDocumentCookie: YouTube PREF cookie must be set directly for theme sync
      document.cookie = `PREF=${pref};path=/;domain=.youtube.com;max-age=2419200`;
    } catch (_err) {
      logS(_err);
    }
  };

  /**
   * Apply a new theme preference.
   * - Saves to localStorage for early access on next load.
   * - Writes PREF cookie for server-side hint.
   * - Directly enforces theme by adding/removing html[dark].
   * @param {'dark' | 'light' | 'device'} pref
   */
  const applyThemePreference = pref => {
    themePreference = pref;
    // Save to direct localStorage key for early access on next page load
    try {
      window.YouTubePlusSettingsStore?.writeRaw?.(PREF_KEY, pref);
    } catch (_e) {
      logS(_e);
    }
    // Записать cookie PREF, меняя ТОЛЬКО два бита темы и сохраняя все прочие
    // флаги пользователя (часовой пояс и т.п. живут в том же поле).
    const base = (readPrefF6() ?? 0) & ~YT_PREF_DARK_BIT & ~YT_PREF_LIGHT_BIT;
    if (pref === 'dark') {
      writePrefCookie((base | YT_PREF_DARK_BIT).toString(16));
    } else if (pref === 'light') {
      writePrefCookie((base | YT_PREF_LIGHT_BIT).toString(16));
    } else {
      // device: оба бита сняты, YouTube берёт тему от системы.
      writePrefCookie(base ? base.toString(16) : null);
    }
    // Enforce immediately
    enforceTheme();
  };

  // ---- Bootstrap ----

  readThemePreferenceEarly();
  readThemeVariant();
  applyThemeVariant();

  // Enforce theme on first paint (before YouTube's Polymer initializes).
  enforceTheme();

  // MutationObserver: guard against YouTube re-adding [dark] to ANY element
  // when we're in locked mode (force light or force dark).
  // Uses subtree:true to catch dark attribute on html, ytd-app, body,
  // popup containers, and all other YouTube components. Only YouTube re-adds
  // it, so on myactivity the guard is not installed.
  const htmlEl = typeof document !== 'undefined' ? document.documentElement : null;
  if (htmlEl && window.YouTubePlusHostPolicy?.hostClass?.() !== 'myactivity') {
    try {
      // lint:custom:ignore
      const rawThemeObserver = new MutationObserver(mutations => {
        if (themePreference === 'device') return;
        // Check if any mutation actually involves the 'dark' attribute
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'dark') {
            enforceTheme();
            return;
          }
        }
      });
      const themeObserver =
        window.YouTubePlusCleanupManager?.registerObserver?.(rawThemeObserver) || rawThemeObserver;
      themeObserver.observe(htmlEl, {
        attributes: true,
        attributeFilter: ['dark'],
        subtree: true,
      });
    } catch (_err) {
      logS(_err);
    }
  }

  // Listen for settings changes
  try {
    if (typeof window !== 'undefined') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        window,
        'youtube-plus-settings-updated',
        () => {
          readThemePreferenceEarly();
          readThemeVariant();
          applyThemeVariant();
          enforceTheme();
        },
        undefined,
        true
      );
    }
  } catch (_err) {
    logS(_err);
  }

  // Expose for tests / other modules (sandbox scope only; the theme state
  // is not provisioned to page scripts).
  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      ...window.YouTubePlusDesignSystem,
      applyThemePreference,
      getThemePreference: () => themePreference,
      applyThemeVariant,
      getThemeVariant: () => themeVariant,
    };
  }
})();

(function () {
  const logger = window.YouTubePlusLogger || window.YouTubeUtils?.logger || null;
  const U = window.YouTubeUtils;
  /**
   * @param {unknown} err
   * @param {string} [label]
   */
  const logS = (err, label = undefined) => U?.logSuppressed?.(err, label || 'DesignSystem');

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
    // lint:custom:ignore
    const rawStyleObserver = new MutationObserver(() => {
      ensureRenderedStylesAlive();
    });
    styleObserver =
      window.YouTubePlusCleanupManager?.registerObserver?.(rawStyleObserver, null, {
        scope: 'session',
      }) || rawStyleObserver;
    styleObserver.observe(host, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const parent = host.parentNode;
    if (parent) {
      styleObserver.observe(parent, { childList: true, subtree: false });
    }
  };

  /**
   * Schedule a render of all registered styles on the next animation frame.
   */
  const scheduleRender = () => {
    if (renderScheduled) return;
    renderScheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      const cm = window.YouTubePlusCleanupManager;
      // Session scope: the per-navigation sweep must not cancel a pending
      // render while styles are still changing.
      const frameId = requestAnimationFrame(() => {
        cm?.unregisterAnimationFrame?.(frameId);
        renderScheduled = false;
        renderStyles();
      });
      cm?.registerAnimationFrame?.(frameId, { scope: 'session' });
    } else {
      const cm = window.YouTubePlusCleanupManager;
      const render = () => {
        renderScheduled = false;
        renderStyles();
      };
      if (cm?.timeout) {
        // Managed timer: it unregisters itself when it fires.
        cm.timeout(render, 0, { scope: 'session' });
      } else {
        setTimeout(render, 0);
      }
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
        logS(_error);
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

  /** Watch a head root for replacement and keep the rendered styles alive.
   * @param {Element} root */
  const installHeadObserver_ = root => {
    observedHeadRoot = root;
    // lint:custom:ignore
    const rawHeadObserver = new MutationObserver(() => {
      ensureRenderedStylesAlive();
    });
    headObserver =
      window.YouTubePlusCleanupManager?.registerObserver?.(rawHeadObserver, null, {
        scope: 'session',
      }) || rawHeadObserver;
    headObserver.observe(root, { childList: true, subtree: false });
  };

  /** Rebuild the head observer after the head root was replaced.
   * @param {Element|null} nextHeadRoot */
  const resyncHeadObserver_ = nextHeadRoot => {
    if (headObserver) {
      headObserver.disconnect();
      headObserver = null;
    }
    observedHeadRoot = nextHeadRoot;
    if (!nextHeadRoot) return;
    // lint:custom:ignore
    const rawHeadObs = new MutationObserver(() => {
      ensureRenderedStylesAlive();
    });
    headObserver =
      window.YouTubePlusCleanupManager?.registerObserver?.(rawHeadObs, null, {
        scope: 'session',
      }) || rawHeadObs;
    headObserver.observe(nextHeadRoot, { childList: true, subtree: false });
  };

  const observeStyleContainers = () => {
    if (typeof MutationObserver === 'undefined') return;

    if (!documentObserver && document.documentElement) {
      // lint:custom:ignore
      const rawDocObserver = new MutationObserver(() => {
        const nextHeadRoot = document.head || document.documentElement;
        if (nextHeadRoot !== observedHeadRoot) resyncHeadObserver_(nextHeadRoot);
        ensureRenderedStylesAlive();
      });
      documentObserver =
        window.YouTubePlusCleanupManager?.registerObserver?.(rawDocObserver, null, {
          scope: 'session',
        }) || rawDocObserver;
      documentObserver.observe(document.documentElement, {
        childList: true,
        subtree: false,
      });
    }

    const nextHeadRoot = document.head || document.documentElement;
    if (!headObserver && nextHeadRoot) {
      installHeadObserver_(nextHeadRoot);
    }
  };

  // The style-container observers recover from YouTube replacing <head>; the
  // comment panel on myactivity does not need them.
  if (window.YouTubePlusHostPolicy?.hostClass?.() !== 'myactivity') {
    observeStyleContainers();
  }

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
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        () => {
          earlyRenderListener = false;
          const lateHost = ensureStyleHost();
          if (!lateHost) return;
          const lateText = computeRenderText();
          if (lateHost.textContent !== lateText) lateHost.textContent = lateText;
        },
        { once: true },
        true
      );
    } catch (error) {
      logS(error);
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
   * Retrieve a registered stylesheet by id (empty string if absent).
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
      logS(error);
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
      logS(error);
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
          logS(_error);
        }
        styleObserver = null;
      }
    } catch (error) {
      logS(error);
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
       * Re-check and re-render styles if the host element is gone.
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
  }

  styleManager.add(
    'yp-design-system',
    `
    /* ----------------------------------------------------------------
     * YouTube+ design tokens (docs/DESIGN.md): the --yp-* variables in
     * the blocks below. New CSS uses only these; the older --yt-* ones
     * are migrated bundle by bundle.
     * ---------------------------------------------------------------- */
    /* Keyboard focus on every YouTube+ control. */
    :is([class^="yp-"],[class*=" yp-"]):is(button,a,input,select,textarea,[role="button"],[role="tab"],[role="switch"],[tabindex]):focus-visible,
    :is(.yp-settings-modal,.yp-download-modal-overlay,.stats-modal-overlay,#timecode-panel,.yp-comments-modal,.vision-dock) :is(button,a,input,select,textarea,[role="button"],[role="tab"],[role="switch"],[tabindex]):focus-visible{
      outline:var(--yp-focus-ring);
      outline-offset:2px;
    }
    :root{
      --yp-accent:#ff0033;
      --yp-accent-soft:rgba(255,0,51,.14);
      --yp-accent-strong:#cc0029;
      --yp-accent-strong-hover:#99001f;
      --yp-text-on-accent:#fff;
      --yp-success:#22c55e;
      --yp-success-soft:rgba(34,197,94,.15);
      --yp-warning:#f5b400;
      --yp-warning-soft:rgba(245,180,0,.18);
      --yp-danger:#ff4d4f;
      --yp-danger-soft:rgba(255,77,79,.15);
      --yp-info:#3ea6ff;
      --yp-info-soft:rgba(62,166,255,.15);
      --yp-chart-1:#3b82f6;
      --yp-chart-2:#22c55e;
      --yp-chart-3:#ef4444;
      --yp-chart-4:#a855f7;
      --yp-chart-5:#eab308;
      --yp-chart-6:#ec4899;
      --yp-chart-7:#0ea5e9;
      --yp-r-xs:6px;
      --yp-r-sm:10px;
      --yp-r-md:14px;
      --yp-r-lg:20px;
      --yp-r-pill:999px;
      --yp-s-1:4px;
      --yp-s-2:8px;
      --yp-s-3:12px;
      --yp-s-4:16px;
      --yp-s-5:24px;
      --yp-s-6:32px;
      --yp-fs-xs:12px;
      --yp-fs-sm:13px;
      --yp-fs-md:14px;
      --yp-fs-lg:16px;
      --yp-fs-xl:20px;
      --yp-z-overlay:1000;
      --yp-z-flyout:20000;
      --yp-z-modal:100000;
      --yp-z-toast:100100;
      --yp-dur-1:90ms;
      --yp-dur-2:150ms;
      --yp-dur-3:220ms;
      --yp-dur-4:320ms;
      --yp-ease:cubic-bezier(.2,0,0,1);
      --yp-ease-in:cubic-bezier(.05,.7,.1,1);
      --yp-ease-out:cubic-bezier(.3,0,.8,.15);
      --yp-ease-spring:linear(0,.007,.029 2.2%,.118 4.6%,.27 7.4%,.48 10.6%,.693 14.3%,.86 18.4%,.973 23.2%,1.031 28.6%,1.05 34.6%,1.043 41.6%,1.022 50%,1.004 61%,.998 75%,1);
      --yp-focus-ring:2px solid var(--yp-accent);
      --yp-scrim-blur:blur(8px) saturate(140%);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
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
      --yt-transition-fast:transform .14s cubic-bezier(.2,.8,.2,1), opacity .14s cubic-bezier(.2,.8,.2,1), background-color .14s cubic-bezier(.2,.8,.2,1), border-color .14s cubic-bezier(.2,.8,.2,1), color .14s cubic-bezier(.2,.8,.2,1), box-shadow .14s cubic-bezier(.2,.8,.2,1);
      --yt-transition-default:transform .24s cubic-bezier(.2,.8,.2,1), opacity .24s cubic-bezier(.2,.8,.2,1), background-color .24s cubic-bezier(.2,.8,.2,1), border-color .24s cubic-bezier(.2,.8,.2,1), color .24s cubic-bezier(.2,.8,.2,1), box-shadow .24s cubic-bezier(.2,.8,.2,1);
      --yt-glass-blur:var(--yp-mat-blur);
      --yt-glass-blur-light:var(--yp-mat-thin-blur);
      --yt-glass-blur-heavy:var(--yp-mat-thick-blur);
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
      --yt-stats-error:#ff6b6b;
      --yt-stats-link-color:#0b61d6;
      --yt-stats-link-hover:#e6f0ff;
      --yt-stats-link-hover-dark:#0647a6;
      --yt-stats-shadow-hover:rgba(0,0,0,0.3);
      --yt-stats-shadow-deep:rgba(0,0,0,0.32);
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
      --yt-stats-positive-indicator:#1ed760;
      --yt-stats-negative-indicator:#f3727f;
      --yt-stats-channel-filter-shadow:rgba(0,0,0,0.5);
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

    html[dark]{
      --yp-text-1:#fff;
      --yp-text-2:#aaa;
      --yp-text-3:rgba(255,255,255,.5);
      --yp-fill-1:rgba(255,255,255,.08);
      --yp-fill-2:rgba(255,255,255,.12);
      --yp-fill-3:rgba(255,255,255,.16);
      --yp-line-1:rgba(255,255,255,.1);
      --yp-line-2:rgba(255,255,255,.2);
      --yp-scrim:rgba(0,0,0,.6);
      --yp-shadow-1:0 2px 8px rgba(0,0,0,.35);
      --yp-shadow-2:0 10px 30px rgba(0,0,0,.45);
      --yp-shadow-3:0 20px 56px rgba(0,0,0,.55);
      --yp-mat-thin-bg:rgba(28,28,28,.55);
      --yp-mat-thin-line:rgba(255,255,255,.12);
      --yp-mat-thin-blur:blur(12px) saturate(160%);
      --yp-mat-bg:rgba(28,28,28,.65);
      --yp-mat-line:rgba(255,255,255,.15);
      --yp-mat-blur:blur(18px) saturate(180%);
      --yp-mat-shadow:var(--yp-shadow-2);
      --yp-mat-thick-bg:rgba(22,22,22,.72);
      --yp-mat-thick-line:rgba(255,255,255,.15);
      --yp-mat-thick-blur:blur(24px) saturate(200%);
      --yp-mat-thick-shadow:var(--yp-shadow-3);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      --yt-bg-primary:rgba(15,15,15,.85);
      --yt-bg-secondary:rgba(28,28,28,.85);
      --yt-bg-tertiary:rgba(34,34,34,.85);
      --yt-text-primary:#fff;
      --yt-text-secondary:#aaa;
      --yt-border-color:rgba(255,255,255,.2);
      --yt-hover-bg:rgba(255,255,255,.1);
      --yt-shadow:0 4px 12px rgba(0,0,0,.25);
      --yt-glass-bg:rgba(28,28,28,.65);
      --yt-glass-border:rgba(255,255,255,.15);
      --yt-glass-shadow:0 16px 48px rgba(0,0,0,.45);
      --yt-solid-bg:#212121;
      --yt-solid-border:rgba(255,255,255,.12);
      --yt-solid-shadow:0 16px 48px rgba(0,0,0,.75);
      --yt-modal-bg:rgba(0,0,0,.7);
      --yt-notification-bg:rgba(28,28,28,.9);
      --yt-panel-bg:rgba(20,20,20,.5);
      --yt-header-bg:rgba(20,20,20,.6);
      --yt-input-bg:rgba(255,255,255,.1);
      --yt-button-bg:rgba(255,255,255,.15);
      --yt-text-stroke:#fff;
      --yt-rail-gradient-start:rgba(255,255,255,.06);
      --yt-rail-gradient-end:rgba(255,255,255,.03);
      --yt-rail-inset:rgba(255,255,255,.08);
    }

    html:not([dark]){
      --yp-text-1:#0f0f0f;
      --yp-text-2:#606060;
      --yp-text-3:rgba(0,0,0,.45);
      --yp-fill-1:rgba(0,0,0,.05);
      --yp-fill-2:rgba(0,0,0,.08);
      --yp-fill-3:rgba(0,0,0,.12);
      --yp-line-1:rgba(0,0,0,.08);
      --yp-line-2:rgba(0,0,0,.16);
      --yp-scrim:rgba(0,0,0,.4);
      --yp-shadow-1:0 1px 4px rgba(0,0,0,.08);
      --yp-shadow-2:0 8px 24px rgba(0,0,0,.12);
      --yp-shadow-3:0 16px 44px rgba(0,0,0,.16);
      --yp-mat-thin-bg:rgba(255,255,255,.6);
      --yp-mat-thin-line:rgba(0,0,0,.08);
      --yp-mat-thin-blur:blur(12px) saturate(160%);
      --yp-mat-bg:rgba(255,255,255,.7);
      --yp-mat-line:rgba(0,0,0,.1);
      --yp-mat-blur:blur(18px) saturate(180%);
      --yp-mat-shadow:var(--yp-shadow-2);
      --yp-mat-thick-bg:rgba(255,255,255,.8);
      --yp-mat-thick-line:rgba(0,0,0,.1);
      --yp-mat-thick-blur:blur(24px) saturate(200%);
      --yp-mat-thick-shadow:var(--yp-shadow-3);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
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
      --yt-glass-shadow:0 12px 36px rgba(0,0,0,.12);
      --yt-solid-bg:#ffffff;
      --yt-solid-border:rgba(0,0,0,.1);
      --yt-solid-shadow:0 12px 32px rgba(0,0,0,.1);
      --yt-modal-bg:rgba(0,0,0,.4);
      --yt-notification-bg:rgba(255,255,255,.95);
      --yt-panel-bg:rgba(240,240,240,.6);
      --yt-header-bg:rgba(248,248,248,.8);
      --yt-input-bg:rgba(0,0,0,.05);
      --yt-button-bg:rgba(0,0,0,.08);
      --yt-text-stroke:#030303;
      --yt-rail-gradient-start:rgba(0,0,0,.04);
      --yt-rail-gradient-end:rgba(0,0,0,.02);
      --yt-rail-inset:rgba(0,0,0,.06);
      --yt-surface-soft:rgba(0,0,0,.05);
      --yt-surface-active:rgba(0,0,0,.08);
      --yt-surface-active-strong:rgba(0,0,0,.12);
      --yt-surface-border-strong:rgba(0,0,0,.12);
      --yt-surface-overlay-soft:rgba(0,0,0,.06);
      --yt-surface-overlay-subtle:rgba(0,0,0,.04);
      --yt-surface-overlay-faint:rgba(0,0,0,.02);
      --yt-surface-overlay-border:rgba(0,0,0,.08);
    }

    /* ----------------------------------------------------
     * SOLID MATERIAL OVERRIDES (Variable Level)
     * ---------------------------------------------------- */
    html[dark][data-yp-style="solid"]{
      --yp-mat-thin-bg:#212121;
      --yp-mat-bg:#212121;
      --yp-mat-thick-bg:#181818;
      --yp-mat-thin-blur:none;
      --yp-mat-blur:none;
      --yp-mat-thick-blur:none;
      --yp-scrim-blur:none;
      --yt-glass-bg:var(--yt-solid-bg);
      --yt-glass-border:var(--yt-solid-border);
      --yt-glass-shadow:var(--yt-solid-shadow);
      --yt-glass-blur:none;
      --yt-glass-blur-light:none;
      --yt-glass-blur-heavy:none;
      --yt-bg-primary:#212121;
      --yt-bg-secondary:#181818;
      --yt-bg-tertiary:#282828;
      --yt-panel-bg:#181818;
      --yt-header-bg:#181818;
      --yt-modal-bg:rgba(0,0,0,.75);
    }

    html:not([dark])[data-yp-style="solid"]{
      --yp-mat-thin-bg:#fff;
      --yp-mat-bg:#fff;
      --yp-mat-thick-bg:#fff;
      --yp-mat-thin-blur:none;
      --yp-mat-blur:none;
      --yp-mat-thick-blur:none;
      --yp-scrim-blur:none;
      --yt-glass-bg:var(--yt-solid-bg);
      --yt-glass-border:var(--yt-solid-border);
      --yt-glass-shadow:var(--yt-solid-shadow);
      --yt-glass-blur:none;
      --yt-glass-blur-light:none;
      --yt-glass-blur-heavy:none;
      --yt-bg-primary:#ffffff;
      --yt-bg-secondary:#f2f2f2;
      --yt-bg-tertiary:#e6e6e6;
      --yt-panel-bg:#f2f2f2;
      --yt-header-bg:#f8f8f8;
      --yt-modal-bg:rgba(0,0,0,.35);
    }


    .yp-btn{
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
    .yp-btn:hover{
      transform:translateY(-1px);
      box-shadow:var(--yt-shadow);
      background:var(--yt-hover-bg);
    }
    .yp-btn:active{
      transform:translateY(-1px) scale(0.96) !important;
    }
    .yp-btn--primary{
      background:transparent;
    }
    .yp-btn--primary:hover{
      background:var(--yt-accent);
      color:#fff;
      box-shadow:0 6px 16px rgba(255,0,0,.35);
    }

    .yp-panel{
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background:var(--yt-glass-bg);
      border:1px solid var(--yt-glass-border);
      border-radius:var(--yt-radius-md);
      box-shadow:var(--yt-glass-shadow);
      color:var(--yt-text-primary);
    }

    .yp-modal-overlay{
      position:fixed;
      inset:0;
      background:var(--yt-modal-bg);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index:var(--yt-z-modal);
      backdrop-filter:var(--yp-scrim-blur);
      -webkit-backdrop-filter:var(--yp-scrim-blur);
      animation:ytEnhanceFadeIn .25s ease-out;
    }

    .yp-modal-content{
      background:var(--yt-glass-bg);
      border:1.5px solid var(--yt-glass-border);
      border-radius:24px;
      color:var(--yt-text-primary);
      box-shadow:0 12px 40px rgba(0,0,0,.45);
      backdrop-filter:var(--yp-mat-thick-blur);
      -webkit-backdrop-filter:var(--yp-mat-thick-blur);
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

    @keyframes yp-resume-fadein{from{opacity:0;}to{opacity:1;}}

    /* Reduced motion: every YouTube+ surface drops movement; fades stay
       short and loading spinners keep turning. */
    @media (prefers-reduced-motion: reduce){
      :root{
        --yp-dur-3:var(--yp-dur-2);
        --yp-dur-4:var(--yp-dur-2);
      }
      :is([class*="yp-"],[class*="yp-"],[class*="comment-controls"],.vision-dock,.vision-top-center-dock,#timecode-panel,.stats-modal-overlay,.yp-download-modal-overlay,.thumbnail-modal-overlay,.youtube-enhancer-notification,.top-button):not([class*="spinner"]),
      :is([class*="yp-"],[class*="yp-"],[class*="comment-controls"],.vision-dock,.vision-top-center-dock,#timecode-panel,.stats-modal-overlay,.yp-download-modal-overlay,.thumbnail-modal-overlay,.youtube-enhancer-notification,.top-button) :not([class*="spinner"]),
      :is([class*="yp-"],[class*="yp-"],[class*="comment-controls"])::before,
      :is([class*="yp-"],[class*="yp-"],[class*="comment-controls"])::after{
        animation:none !important;
        transition-property:opacity,color,background-color,border-color !important;
        transition-duration:var(--yp-dur-2) !important;
      }
    }
  `
  );
})();

(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'DesignSystem');
  // ===========================================================================
  // Central static-CSS registry
  // ---------------------------------------------------------------------------
  // Modules keep only their logic and reference their stylesheet here by id via
  // `window.YouTubePlusDesignSystem.getStyle(id)`. Only fully static CSS lives
  // here; CSS that is generated from runtime values (user settings, dynamic
  // selectors, percentages) stays in its module because it cannot be a constant.
  // ===========================================================================
  const VAL_ROUNDED_A1 = 12;
  const STYLE_BUNDLES = {
    'yp-thumbnail-hover': `
        /* yt-thumbnail hover */
        #inline-preview-player {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 1s !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player) {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important; border-radius: 1.2em !important; overflow: hidden !important; transform: scale(1) !important;}
        #video-preview-container:has(#inline-preview-player):hover {transform: scale(1.25) !important; box-shadow: rgba(0,0,0,0.5) 0px 0px 60px !important; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 2s !important;}
        ytd-app #content {opacity: 1 !important; transition: opacity 0.3s ease-in-out !important;}
        ytd-app:has(#video-preview-container:hover) #content {opacity: 0.5 !important; transition: opacity 4s ease-in-out 1s !important;}
      `,
    'yp-immersive-search': `
        /* yt-Immersive search */
        #page-manager, yt-searchbox {transition: width 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), margin 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), opacity 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), filter 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), left 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), top 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), height 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35), max-width 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35) !important;}
        #masthead yt-searchbox button[aria-label="Search"] {display: none !important;}
        .ytSearchboxComponentInputBox {border-radius: 2em !important;}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) {position: relative !important; left: 0vw !important; top: -30vh !important; height: 40px !important; max-width: 600px !important; transform: scale(1) !important;}
        @media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) { height: 60px !important; max-width: 700px !important; transform: scale(1.1) !important;}}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox,
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: var(--yt-bg-primary) !important; box-shadow: black 0 0 30px !important;}
        yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 10px !important;}
        @media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 30px !important;}}
        .ytd-masthead #center:has(.ytSearchboxComponentInputBoxHasFocus) {height: 100vh !important; width: 100vw !important; left: 0 !important; top: 0 !important; position: fixed !important; justify-content: center !important; align-items: center !important;}
        #content:has(.ytSearchboxComponentInputBoxHasFocus) #page-manager {opacity: .3 !important; transform: scale(1.05) !important;}
      `,
    'yp-hide-voice-search': `
        /* No voice search button */
        #voice-search-button {display: none !important;}
      `,
    'yp-transparent-header': `
        /* Transparent header */
        #masthead-container,
        ytd-masthead,
        #masthead {
          --yt-spec-base-background: transparent;
          --ytd-masthead-background: transparent;
          --yt-spec-brand-background-primary: transparent;
          --yt-spec-brand-background-solid: transparent;
          --yt-spec-general-background-a: transparent;
          --yt-spec-raised-background: transparent;
          --yt-spec-additive-background: transparent;
        }
        #masthead-container,
        #masthead,
        ytd-masthead,
        #background.ytd-masthead,
        ytd-masthead #background,
        ytd-masthead #container,
        ytd-masthead #contentContainer,
        ytd-masthead #end,
        ytd-masthead #start,
        ytd-masthead #center,
        ytd-masthead #frosted-glass,
        ytd-masthead #background-content,
        #frosted-glass,
        ytd-masthead tp-yt-app-header-layout,
        ytd-mini-guide-renderer,
        ytd-topbar-logo-renderer,
        ytd-app #masthead,
        ytd-app #masthead-container,
        tp-yt-app-header-layout #masthead-container {
          background-color: transparent !important;
          background: transparent !important;
          box-shadow: none !important;
        }
      `,
    'yp-hide-side-guide': `
        /* Hide side guide */
        ytd-mini-guide-renderer, [theater=""] #contentContainer::after {display: none !important;}
        tp-yt-app-drawer > #contentContainer:not([opened=""]),
        #contentContainer:not([opened=""]) #guide-content,
        ytd-mini-guide-renderer,
        ytd-mini-guide-entry-renderer {background-color: var(--yt-spec-text-primary-inverse) !important; background: var(--yt-spec-text-primary-inverse) !important;}
        #content:not(:has(#contentContainer[opened=""])) #page-manager {margin-left: 0 !important;}
        ytd-app:not([guide-persistent-and-visible=""]) tp-yt-app-drawer > #contentContainer {background-color: var(--yt-spec-text-primary-inverse) !important;}
        ytd-alert-with-button-renderer {align-items: center !important; justify-content: center !important;}
      `,
    'yp-clean-side-guide': `
        /* Clean side guide */
        ytd-guide-section-renderer:has([title="YouTube Premium"]),
        ytd-guide-renderer #footer {display: none !important;}
        ytd-guide-section-renderer, ytd-guide-collapsible-section-entry-renderer {border: none !important;}
      `,
    'yp-side-videos-grid': `
        /* Side videos: multi-column card grid. The column count and card width
           come from --yp-side-cols / --yp-side-width, set by the side-videos style. */
        #secondary #related {
          min-width: 0 !important;
          overflow: visible !important;
        }
        #secondary {
          overflow: visible !important;
        }
        #secondary #related ytd-item-section-renderer.ytd-watch-next-secondary-results-renderer {
          width: var(--yp-side-width, 100%) !important;
        }
        #secondary #related #contents,
        #secondary #related ytd-watch-next-secondary-results-renderer #items {
          display: grid !important;
          grid-template-columns: repeat(var(--yp-side-cols, 1), minmax(0, 1fr)) !important;
          gap: 8px !important;
          padding: 0 !important;
          align-items: start !important;
        }
        /* yt-lockup-view-model: card container */
        #secondary #related yt-lockup-view-model {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        /* Host div: switch from horizontal row to vertical column */
        #secondary #related .ytLockupViewModelHost {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          width: 100% !important;
          min-width: 0 !important;
          gap: 0 !important;
          flex-wrap: nowrap !important;
        }
        /* Thumbnail link: override inline style="width: 55%" */
        #secondary #related .ytLockupViewModelContentImage {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          flex: 0 0 auto !important;
          position: relative !important;
        }
        /* Thumbnail image container */
        #secondary #related .ytThumbnailViewModelHost {
          width: 100% !important;
          max-width: 100% !important;
        }
        #secondary #related .ytThumbnailViewModelImage {
          width: 100% !important;
          aspect-ratio: 16 / 9 !important;
        }
        #secondary #related .ytThumbnailViewModelImage img {
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
          display: block !important;
        }
        /* Metadata: full width */
        #secondary #related .ytLockupViewModelMetadata {
          width: 100% !important;
          min-width: 0 !important;
          flex: 1 1 auto !important;
        }
        #secondary #related yt-lockup-metadata-view-model {
          width: 100% !important;
        }
        #secondary #related .ytLockupMetadataViewModelTextContainer {
          width: 100% !important;
          min-width: 0 !important;
        }
        #secondary #related .ytLockupMetadataViewModelHeadingReset {
          width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          display: -webkit-box !important;
          -webkit-line-clamp: 2 !important;
          -webkit-box-orient: vertical !important;
        }
        /* Legacy compact renderers (fallback) */
        #secondary #related ytd-compact-video-renderer,
        #secondary #related ytd-compact-radio-renderer,
        #secondary #related ytd-compact-playlist-renderer {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          margin: 0 !important;
          box-sizing: border-box !important;
        }
        #secondary #related ytd-compact-video-renderer #dismissible,
        #secondary #related ytd-compact-radio-renderer #dismissible,
        #secondary #related ytd-compact-playlist-renderer #dismissible {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          width: 100% !important;
        }
        #secondary #related ytd-compact-video-renderer ytd-thumbnail,
        #secondary #related ytd-compact-radio-renderer ytd-thumbnail,
        #secondary #related ytd-compact-playlist-renderer ytd-thumbnail {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }
        #secondary #related ytd-compact-video-renderer .details,
        #secondary #related ytd-compact-video-renderer #meta {
          padding-left: 0 !important;
          min-width: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }
      `,
    'yp-fix-feed-layout': `
        /* Fix new feed layout */
        @media only screen and (min-width: 1400px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 4 !important; }
        }
        @media only screen and (min-width: 1700px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 5 !important; }
        }
        @media only screen and (min-width: 2180px) {
          ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-grid-items-per-row: 6 !important; }
        }
        ytd-rich-item-renderer[is-in-first-column] { margin-left: calc(var(--ytd-rich-grid-item-margin) / 2) !important; }
        #contents { padding-left: calc(var(--ytd-rich-grid-item-margin) / 2 + var(--ytd-rich-grid-gutter-margin)) !important; }
      `,
    'yp-better-captions': `
        /* Better captions */
        .caption-window { backdrop-filter: var(--yp-mat-thin-blur) !important; border-radius: 1em !important; padding: 1em !important; box-shadow: rgba(0,0,0,0.5) 0 0 20px !important; width: fit-content !important; }
        .ytp-caption-segment { background: none !important; }
      `,
    'yp-player-blur': `
        /* Player controls blur */
        .ytp-left-controls .ytp-play-button,
        .ytp-left-controls .ytp-volume-area,
        .ytp-left-controls .ytp-time-display.notranslate > span,
        .ytp-left-controls .ytp-chapter-container > button,
        .ytp-left-controls .ytp-prev-button,
        .ytp-left-controls .ytp-next-button,
        .ytp-right-controls,
        .ytp-time-wrapper,
        .ytPlayerQuickActionButtonsHost,
        .ytPlayerQuickActionButtonsHostCompactControls,
        .ytPlayerQuickActionButtonsHostDisableBackdropFilter {
          backdrop-filter: var(--yt-glass-blur) !important;
          -webkit-backdrop-filter: var(--yt-glass-blur) !important;
          background-color: var(--yt-glass-bg) !important;
          border: 1px solid var(--yt-glass-border) !important;
          color: var(--yt-text-primary) !important;
        }
        .ytp-popup {
          backdrop-filter: var(--yt-glass-blur) !important;
          -webkit-backdrop-filter: var(--yt-glass-blur) !important;
          background-color: var(--yt-glass-bg) !important;
          border: 1px solid var(--yt-glass-border) !important;
          box-shadow: var(--yt-glass-shadow) !important;
          color: var(--yt-text-primary) !important;
        }
        .ytp-popup .ytp-menuitem:not([aria-disabled="true"]):hover {
          background-color: var(--yt-hover-bg) !important;
        }
        html:not([dark]) .ytp-popup {
          --yt-sys-color-baseline--overlay-text-primary: var(--yt-text-primary);
          --yt-sys-color-baseline--overlay-text-secondary: var(--yt-text-secondary);
          --yt-sys-color-baseline--overlay-text-disabled: rgba(0, 0, 0, 0.35);
          --yt-sys-color-baseline--overlay-outline: var(--yt-border-color);
        }
        html:not([dark]) .ytp-left-controls .ytp-play-button,
        html:not([dark]) .ytp-left-controls .ytp-volume-area,
        html:not([dark]) .ytp-left-controls .ytp-time-display.notranslate > span,
        html:not([dark]) .ytp-left-controls .ytp-time-display span,
        html:not([dark]) .ytp-left-controls .ytp-chapter-container > button,
        html:not([dark]) .ytp-left-controls .ytp-chapter-title-content,
        html:not([dark]) .ytp-left-controls .ytp-prev-button,
        html:not([dark]) .ytp-left-controls .ytp-next-button,
        html:not([dark]) .ytp-right-controls,
        html:not([dark]) .ytp-right-controls .ytp-button,
        html:not([dark]) .ytp-time-wrapper,
        html:not([dark]) .ytp-popup,
        html:not([dark]) .ytp-popup .ytp-panel,
        html:not([dark]) .ytp-popup .ytp-panel-menu,
        html:not([dark]) .ytp-popup .ytp-menuitem-label,
        html:not([dark]) .ytp-popup .ytp-menuitem-content,
        html:not([dark]) .ytp-popup .ytp-panel-title,
        html:not([dark]) .ytp-popup .ytp-panel-header,
        html:not([dark]) .ytp-popup .ytp-panel-footer,
        html:not([dark]) .ytp-popup .ytp-panel-back-button,
        html:not([dark]) .ytp-popup .ytp-variable-speed-panel-display,
        html:not([dark]) .ytp-popup .ytp-speedslider-text {
          color: var(--yt-text-primary) !important;
          text-shadow: none !important;
        }
        html:not([dark]) .ytp-left-controls .ytp-svg-fill,
        html:not([dark]) .ytp-right-controls .ytp-svg-fill,
        html:not([dark]) .ytp-left-controls svg[fill="#fff"],
        html:not([dark]) .ytp-right-controls svg[fill="#fff"],
        html:not([dark]) .ytp-left-controls path[fill="#fff"],
        html:not([dark]) .ytp-right-controls path[fill="#fff"],
        html:not([dark]) .ytp-left-controls path[fill="white"],
        html:not([dark]) .ytp-right-controls path[fill="white"],
        html:not([dark]) .ytp-popup .ytp-svg-fill,
        html:not([dark]) .ytp-popup svg path:not([fill="none"]) {
          fill: var(--yt-text-primary) !important;
        }
        html:not([dark]) .ytp-left-controls svg,
        html:not([dark]) .ytp-right-controls svg,
        html:not([dark]) .ytp-left-controls .ytp-volume-slider-handle {
          filter: none !important;
        }
        html:not([dark]) .ytp-left-controls .ytp-svg-shadow,
        html:not([dark]) .ytp-right-controls .ytp-svg-shadow,
        html:not([dark]) .ytp-popup .ytp-svg-shadow {
          display: none !important;
          stroke: none !important;
        }
        html:not([dark]) .ytp-left-controls .ytp-volume-slider-handle,
        html:not([dark]) .ytp-left-controls .ytp-volume-slider-handle::before {
          background-color: var(--yt-text-primary) !important;
        }
        html:not([dark]) .ytp-left-controls .ytp-volume-slider-handle::after {
          background-color: var(--yt-border-color) !important;
        }
        html:not([dark]) .ytp-popup .ytp-menuitem:not([aria-checked="true"]) .ytp-menuitem-toggle-checkbox,
        html:not([dark]) .ytp-right-controls .ytp-autonav-toggle-button:not([aria-checked="true"]) {
          background-color: rgba(0, 0, 0, 0.25) !important;
        }
        html:not([dark]) .ytp-popup .ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox,
        html:not([dark]) .ytp-right-controls .ytp-autonav-toggle-button[aria-checked="true"] {
          background-color: rgba(0, 0, 0, 0.48) !important;
        }
        html:not([dark]) .ytp-popup .ytp-menuitem-toggle-checkbox::after {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4) !important;
        }
        html:not([dark]) .ytp-popup .ytp-menuitem[aria-haspopup="true"] .ytp-menuitem-content {
          background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHBhdGggZmlsbD0iIzBmMGYwZiIgZmlsbC1vcGFjaXR5PSIuNzUiIGQ9Im0xMi41OSAyMC4zNCA0LjU4LTQuNTktNC41OC00LjU5TDE0IDkuNzVsNiA2LTYgNnoiLz48L3N2Zz4=") !important;
        }
        html:not([dark]) .ytp-delhi-modern .ytp-popup .ytp-menuitem[aria-haspopup="true"] .ytp-menuitem-content {
          background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSIjMGYwZjBmIiBmaWxsLW9wYWNpdHk9Ii43NSIgZD0ibTkuNCAxOC40LS43LS43IDUuNi01LjYtNS43LTUuNy43LS43IDYuNCA2LjR6Ii8+PC9zdmc+") !important;
        }
        html:not([dark]) .ytp-popup .ytp-menuitem[role="menuitemradio"][aria-checked="true"] .ytp-menuitem-label,
        html:not([dark]) .ytp-contextmenu .ytp-menuitem[aria-checked="true"] .ytp-menuitem-toggle-checkbox {
          background-image: url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iIzBmMGYwZiIgZD0iTTkgMTYuMiA0LjggMTJsLTEuNCAxLjRMOSAxOSAyMSA3bC0xLjQtMS40eiIvPjwvc3ZnPg==") !important;
        }
        html:not([dark]) .ytp-popup .ytp-swatch-color-white,
        html:not([dark]) .ytp-popup .ytp-menuitem sup,
        html:not([dark]) .ytp-popup .ytp-menu-label-secondary,
        html:not([dark]) .ytp-popup .ytp-menuitem-sublabel,
        html:not([dark]) .ytp-popup .ytp-menuitem-label-count,
        html:not([dark]) .ytp-popup .ytp-menuitem-keyboard-shortcut,
        html:not([dark]) .ytp-popup .ytp-variable-speed-panel-preset-button-label-text {
          color: var(--yt-text-secondary) !important;
        }
        html:not([dark]) .ytp-popup .ytp-panel-header {
          border-bottom-color: var(--yt-border-color) !important;
        }
        html:not([dark]) .ytp-popup .ytp-panel-footer {
          border-top-color: var(--yt-border-color) !important;
        }
        html:not([dark]) .ytp-popup .ytp-panel-back-button {
          filter: invert(1) !important;
        }
        html:not([dark]) .ytp-popup .ytp-variable-speed-panel-button {
          background-color: rgba(0, 0, 0, 0.08) !important;
          color: var(--yt-text-primary) !important;
        }
        html:not([dark]) .ytp-popup .ytp-variable-speed-panel-button:hover {
          background-color: rgba(0, 0, 0, 0.15) !important;
        }
        html:not([dark]) .ytp-popup .ytp-input-slider::-webkit-slider-runnable-track {
          background: linear-gradient(to right, var(--yt-text-primary) 0, var(--yt-text-primary) var(--yt-slider-shape-gradient-percent), rgba(0, 0, 0, 0.25) var(--yt-slider-shape-gradient-percent), rgba(0, 0, 0, 0.25) 100%) !important;
        }
        html:not([dark]) .ytp-popup .ytp-input-slider::-webkit-slider-thumb {
          background: var(--yt-text-primary) !important;
        }
      `,
    'yp-theater-enhancements': `
        /* Floating comments view (from zeninternet) */
        /* Hide secondary column visually but break containment so fixed children can escape */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #columns #secondary { display: block !important;width: 0 !important;min-width: 0 !important;max-width: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;overflow: visible !important;pointer-events: none !important;flex: 0 0 0px !important;contain: none !important;
        }
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner { overflow: visible !important;contain: none !important;position: static !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner secondary-wrapper,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #secondary-inner .tabview-secondary-wrapper { contain: none !important;overflow: visible !important;position: static !important;max-height: none !important;height: auto !important;padding: 0 !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs { display: block !important;overflow: visible !important;contain: none !important;position: static !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs > header { display: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #right-tabs .tab-content { display: block !important;overflow: visible !important;contain: none !important;position: static !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;border: 0 !important;}
        /* Break containment on tab-comments so its fixed-position child can escape */
        /* Extra .tab-content-hidden selector to beat main.js specificity (line 5169) */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-cld { contain: none !important;overflow: visible !important;position: static !important;display: block !important;visibility: visible !important;width: 0 !important;height: 0 !important;padding: 0 !important;margin: 0 !important;z-index: auto !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments > ytd-item-section-renderer#sections > #contents,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments #contents { contain: none !important;width: auto !important;height: auto !important;max-height: none !important;overflow: visible !important;visibility: visible !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-comments.tab-content-hidden ytd-comments#comments #contents > * { display: block !important;}
        /* Hide other tabs content */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-info,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-videos,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #tab-list { display: none !important;}
        /* Comments overlay panel */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments { visibility: visible !important;display: block !important;background-color: var(--yt-glass-bg) !important;backdrop-filter: var(--yt-glass-blur) !important;-webkit-backdrop-filter: var(--yt-glass-blur) !important;border: 1px solid var(--yt-glass-border) !important;border-right: none !important;box-shadow: var(--yt-glass-shadow) !important;color: var(--yt-text-primary) !important;padding: 0 2em !important;border-radius: 2em 0 0 2em !important;max-height: calc(100vh - 120px) !important;overflow-y: auto !important;position: fixed !important;z-index: 2000 !important;top: 3vh !important;right: -42em !important;width: 40em !important;height: 90vh !important;opacity: 0 !important;pointer-events: auto !important;transition: opacity 0.4s ease, right 0.4s ease !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments:hover { opacity: 1 !important;right: 0 !important;}
        /* Transparent overlay chat: fixed panel */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) [tyt-chat-container],
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat-container { contain: none !important;overflow: visible !important;position: static !important;display: block !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] { visibility: visible !important;display: block !important;position: fixed !important;top: 3vh !important;right: 0 !important;width: 400px !important;height: calc(100vh - 120px) !important;max-height: calc(100vh - 120px) !important;z-index: 2001 !important;opacity: 0.92 !important;pointer-events: auto !important;border-radius: 2em 0 0 2em !important;overflow: hidden !important;background-color: var(--yt-glass-bg) !important;backdrop-filter: var(--yt-glass-blur) !important;-webkit-backdrop-filter: var(--yt-glass-blur) !important;border: 1px solid var(--yt-glass-border) !important;border-right: none !important;box-shadow: var(--yt-glass-shadow) !important;color: var(--yt-text-primary) !important;transition: opacity 0.4s ease !important;}
        html[data-yp-style="solid"] ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat,
        html[data-yp-style="solid"] ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] { opacity: 1 !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] > #show-hide-button,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] > .ytd-live-chat-frame#show-hide-button { display: none !important;visibility: hidden !important;opacity: 0 !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed] iframe { display: block !important;visibility: visible !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat iframe { height: 100% !important;width: 100% !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) yt-live-chat-renderer { background: transparent !important;}
        /* Ambient mode: fix black bars in theater */
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics-container,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics { position: absolute !important;top: 0 !important;left: 0 !important;width: 100% !important;height: 100% !important;overflow: hidden !important;pointer-events: none !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics canvas,
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #cinematics video { position: absolute !important;top: 50% !important;left: 50% !important;transform: translate(-50%, -50%) scale(1.2) !important;min-width: 100% !important;min-height: 100% !important;object-fit: cover !important;}
        ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #player-full-bleed-container { overflow: hidden !important;}
        ytd-watch-flexy[fullscreen] ytd-live-chat-frame { background-color: var(--yt-glass-bg) !important;backdrop-filter: var(--yt-glass-blur) !important;-webkit-backdrop-filter: var(--yt-glass-blur) !important;border-left: 1px solid var(--yt-glass-border) !important;color: var(--yt-text-primary) !important;}
      `,
    'yp-compact-feed': `
      /* Compact feed – reduced spacing, hover menus, inline details */
        ytd-rich-item-renderer { margin-bottom: 15px !important;}
        ytd-rich-item-renderer[rendered-from-rich-grid] { --ytd-rich-item-row-usable-width: calc(100% - var(--ytd-rich-grid-gutter-margin) * 1) !important;}
        ytd-rich-item-renderer #metadata.ytd-video-meta-block { flex-direction: row !important;}
        ytd-rich-item-renderer #metadata.ytd-video-meta-block #metadata-line span:nth-child(3) { height: 1em !important;margin-left: 1em !important;}
        ytd-rich-grid-media { border-radius: 1.2em;height: 100% !important;}
        ytd-rich-grid-media ytd-menu-renderer #button { opacity: 0 !important;transition: opacity 0.3s ease-in-out !important;}
        ytd-rich-grid-media:hover ytd-menu-renderer #button { opacity: 1 !important;}
      `,
    'yp-theme-solid': `
        html[data-yp-style="solid"] {
          --yt-glass-blur:none;
          --yt-glass-blur-light:none;
          --yt-glass-blur-heavy:none;
        }
        html[data-yp-style="solid"][dark] {
          --yt-glass-bg:rgba(24,24,24,.96);
          --yt-panel-bg:rgba(30,30,30,.98);
          --yt-header-bg:rgba(22,22,22,.98);
          --yt-button-bg:rgba(42,42,42,.98);
          --yt-input-bg:rgba(34,34,34,.98);
          --yt-glass-shadow:0 10px 28px rgba(0,0,0,.28);
        }
        html[data-yp-style="solid"]:not([dark]) {
          --yt-glass-bg:rgba(255,255,255,.98);
          --yt-panel-bg:rgba(250,250,250,.99);
          --yt-header-bg:rgba(245,245,245,.99);
          --yt-button-bg:rgba(236,236,236,.98);
          --yt-input-bg:rgba(245,245,245,.98);
          --yt-glass-shadow:0 10px 24px rgba(0,0,0,.12);
        }
        html[data-yp-style="solid"] .yp-settings-panel,
        html[data-yp-style="solid"] .yp-settings-sidebar,
        html[data-yp-style="solid"] .top-button,
        html[data-yp-style="solid"] .download-options.visible,
        html[data-yp-style="solid"] .speed-options.visible,
        html[data-yp-style="solid"] .glass-dropdown__list,
        html[data-yp-style="solid"] .glass-panel,
        html[data-yp-style="solid"] .glass-card,
        html[data-yp-style="solid"] .yp-comments-sidepanel,
        html[data-yp-style="solid"] .yp-comments-item,
        html[data-yp-style="solid"] .youtube-enhancer-notification,
        html[data-yp-style="solid"] .stats-modal-content,
        html[data-yp-style="solid"] .settings-menu,
        html[data-yp-style="solid"] #timecode-panel,
        html[data-yp-style="solid"] #shorts-keyboard-feedback,
        html[data-yp-style="solid"] .shortsStats,
        html[data-yp-style="solid"] .ytp-popup,
        html[data-yp-style="solid"] .ytPlayerQuickActionButtonsHost,
        html[data-yp-style="solid"] .ytPlayerQuickActionButtonsHostCompactControls,
        html[data-yp-style="solid"] .ytPlayerQuickActionButtonsHostDisableBackdropFilter,
        html[data-yp-style="solid"] .caption-window,
        html[data-yp-style="solid"] ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) ytd-comments,
        html[data-yp-style="solid"] ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat,
        html[data-yp-style="solid"] ytd-watch-flexy:is([theater],[full-bleed-player]):not([fullscreen]) #chat[collapsed],
        html[data-yp-style="solid"] ytd-watch-flexy[fullscreen] ytd-live-chat-frame {
          backdrop-filter:none !important;
          -webkit-backdrop-filter:none !important;
        }
      `,
    'yp-cls-prevention': `
        /* CLS Prevention - Reserve space for dynamic elements */
        #yp-dislike-text { min-width: 1.5em;display: inline-block !important;}
        /* Contain layout only for our own panels (not YouTube layout elements) */
        .yp-stats-panel, .yp-modal-content { contain: layout style;}
        /* Reduce CLS from late-loading channel avatars */
        #owner #avatar { min-width: 40px; min-height: 40px; }
        /* Reserve space for action buttons to prevent shift */
        ytd-menu-renderer.ytd-watch-metadata { min-height: 36px; }
        /* Subscribe button stability */
        ytd-subscribe-button-renderer { min-width: 90px; }
      `,
    'yp-dislike-shadow-style': `
          #yp-dislike-text.yp-dislike-text--regular {
            margin-left: 6px !important;
            font-size: 1.4rem !important;
            line-height: 2rem !important;
            font-weight: 500 !important;
            display: inline-block !important;
            visibility: visible !important;
            opacity: 1 !important;
            min-width: 2em !important;
            text-align: center !important;
          }
          :host {
            min-width: fit-content !important;
            width: auto !important;
          }
          yt-button-shape {
            min-width: fit-content !important;
            width: auto !important;
          }
          button.yt-spec-button-shape-next--icon-only-default,
          button.yt-spec-button-shape-next--segmented-end,
          button.yt-spec-button-shape-next,
          button {
            min-width: fit-content !important;
            width: auto !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          button.yt-spec-button-shape-next--segmented-end {
            padding-left: 8px !important;
            padding-right: 12px !important;
          }
          button.yt-spec-button-shape-next--icon-only-default {
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          .yt-spec-button-shape-next__button-text-content {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: fit-content !important;
          }
        `,
    'yp-tabview-core': `
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
[tyt-tab=""] #right-tabs{flex:0 0 auto;min-height:48px}
[tyt-tab=""] #right-tabs .tab-content{display:none;border:0}
#right-tabs > header{flex:0 0 auto}
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
@supports (color: var(--tabview-vision-tabs-define)) {
/* =======================================================================
   Vision variant — floating pill tab bar.

   Classic keeps the original underline bar (red border-bottom on .active),
   which is what every rule above renders. Everything here is scoped to the
   explicit html[data-yp-variant="vision"] attribute that design-system.js
   stamps in applyThemeVariant(), so before that attribute exists the tabs
   fall back to Classic and nothing flashes between the two looks.
   ======================================================================= */
html[data-yp-variant="vision"]{--tyt-tabs-pill-radius:22px;--tyt-tabs-pill-pad:4px;--tyt-tabs-pill-gap:4px;--tyt-tabs-pill-active-bg:var(--yt-sys-color-baseline--surface-container-high,rgba(255,255,255,.12));--tyt-tabs-pill-hover-bg:rgba(255,255,255,.06);--tyt-tabs-pill-border:var(--yt-sys-color-baseline--outline-variant,rgba(255,255,255,.15))}
html[data-yp-variant="vision"]:not([dark]){--tyt-tabs-pill-active-bg:rgba(0,0,0,.08);--tyt-tabs-pill-hover-bg:rgba(0,0,0,.04);--tyt-tabs-pill-border:rgba(0,0,0,.12)}
/* Свёрнуто (вкладка не выбрана): замкнутая капсула со всех сторон. */
html[data-yp-variant="vision"] #right-tabs #material-tabs,
html[data-yp-variant="vision"] [tyt-tab] #right-tabs #material-tabs{border:1px solid var(--tyt-tabs-pill-border);border-radius:var(--tyt-tabs-pill-radius);background:transparent;padding:var(--tyt-tabs-pill-pad);gap:var(--tyt-tabs-pill-gap)}
/* Раскрыто (tyt-tab начинается с "#"): низ стыкуется с панелью контента:
   нижняя граница убрана, скругление остаётся только сверху. Идёт после
   правила выше при равной специфичности, поэтому переопределяет его. */
html[data-yp-variant="vision"] [tyt-tab^="#"] #right-tabs #material-tabs{border-radius:var(--tyt-tabs-pill-radius) var(--tyt-tabs-pill-radius) 0 0;border-bottom:none}
html[data-yp-variant="vision"] ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]{border:0;border-bottom:0;border-radius:calc(var(--tyt-tabs-pill-radius) - var(--tyt-tabs-pill-pad));background:transparent;background-color:transparent;padding:8px 14px;font-size:13px;text-transform:none;transition:background-color 150ms ease,color 150ms ease}
html[data-yp-variant="vision"] ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active{border-bottom:0;background-color:var(--tyt-tabs-pill-active-bg);--tyt-tab-btn-color:var(--tyt-tab-text-primary)}
html[data-yp-variant="vision"] ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]:not(.active):hover{background-color:var(--tyt-tabs-pill-hover-bg)}
html[data-yp-variant="vision"] ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content]>svg{opacity:.75;vertical-align:middle}
html[data-yp-variant="vision"] ytd-watch-flexy #right-tabs .tab-btn[tyt-tab-content].active>svg{opacity:1}
}
@supports (color: var(--tyt-cm-count-define)) {
ytd-watch-flexy{--tyt-x-loading-content-letter-spacing:2px}
html{--tabview-text-loading:"Loading";--tabview-text-fetching:"Fetching";--tabview-panel-loading:var(--tabview-text-loading)}
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
[tyt-playlist-expanded] secondary-wrapper > ytd-playlist-panel-renderer#playlist{overflow:auto;flex-shrink:1;flex-grow:1;min-height:0;max-height:unset!important}
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
    'yp-screenshot-styles': `.yp-screenshot-button,.yp-cobalt-button,.yp-pip-button,.yp-thumbnail-button,.yp-zoom-button,.yp-stats-button,.yp-loop-button,.videoStats.ytp-button{position:relative;width:44px;height:100%;display:inline-flex;align-items:center;justify-content:center;vertical-align:top;background:transparent;border:none;color:inherit;cursor:pointer;transition:opacity .15s,transform .15s;}.yp-screenshot-button:hover,.yp-cobalt-button:hover,.yp-pip-button:hover,.yp-thumbnail-button:hover,.yp-zoom-button:hover,.yp-stats-button:hover,.yp-loop-button:hover,.videoStats.ytp-button:hover{transform:scale(1.1);color:var(--yt-accent,#ff0033);}.yp-screenshot-button:active,.yp-cobalt-button:active,.yp-pip-button:active,.yp-thumbnail-button:active,.yp-zoom-button:active,.yp-stats-button:active,.yp-loop-button:active,.videoStats.ytp-button:active{transform:scale(0.96) !important;}.ytp-right-controls .yp-loop-button svg{width:20px;height:20px;display:block;}`,
    'yp-speedcontrol-styles': `
        .speed-control-btn{width:4em!important;position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;text-align:center!important;border-radius:var(--yt-radius-sm);font-size:13px;color:var(--yt-text-primary);cursor:pointer;user-select:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;transition:color .2s;}
        .speed-control-btn:hover{color:var(--yt-accent);font-weight:bold;}
        .speed-control-btn:active{transform:scale(0.96) !important;}
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
      .shorts-help-panel{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;position:fixed;top:50%;left:25%;transform:translate(-50%,-50%) scale(.9);z-index:10001;opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s ease,transform .3s ease;width:340px;max-width:95vw;max-height:80vh;overflow:hidden;outline:none;color:var(--yt-text-primary);padding:14px;display:flex;flex-direction:column;gap:12px;}
      .shorts-help-panel.visible{opacity:1;visibility:visible;transform:translate(-50%,-50%) scale(1);}
      .help-topbar{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .help-header{margin:0;line-height:1.2;}
      .help-close{position:static;display:flex;align-items:center;justify-content:center;padding:4px;flex-shrink:0;}
      .help-body{display:flex;flex-direction:column;gap:12px;min-height:0;}
      .help-content{padding:8px 10px;max-height:400px;overflow-y:auto;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;border-radius:12px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);}
      .shorts-help-panel.is-dragging .help-content,.help-content:active{cursor:grabbing;}
      .help-item{display:flex;align-items:center;margin-bottom:14px;gap:18px;}
      .help-item kbd{background:var(--yt-button-bg);color:var(--yt-text-primary);padding:7px 14px;border-radius:8px;font-family:monospace;font-size:15px;font-weight:700;min-width:60px;text-align:center;border:1.5px solid var(--yt-glass-border);cursor:pointer;transition:background-color .2s cubic-bezier(0.2,0,0,1), transform .2s cubic-bezier(0.2,0,0,1), border-color .2s cubic-bezier(0.2,0,0,1);position:relative;}
      .help-item kbd:hover{background:var(--yt-hover-bg);transform:scale(1.07);}
      .help-item kbd:not(.non-editable):active{transform:scale(0.96) !important;}
      .help-item kbd:after{content:"✎";position:absolute;top:-7px;right:-7px;font-size:11px;opacity:0;transition:opacity .2s;}
      .help-item kbd:hover:after{opacity:.7;}
      .help-item kbd.non-editable{cursor:default;opacity:.7;}
      .help-item kbd.non-editable:hover{background:var(--yt-button-bg);transform:none;}
      .help-item kbd.non-editable:after{display:none;}
      .help-item span{font-size:15px;color:var(--yt-text-secondary);}
      .help-actions{display:flex;justify-content:flex-end;align-items:center;}
      .reset-all-shortcuts{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
      .shortcut-edit-dialog{z-index:10002;}
      .shortcut-edit-content{padding:28px 32px;min-width:320px;text-align:center;display:flex;flex-direction:column;gap:var(--yt-space-md);color:var(--yt-text-primary);}
      .shortcut-edit-content h4{margin:0 0 14px;font-size:17px;font-weight:700;}
      .shortcut-edit-content p{margin:0 0 18px;font-size:15px;color:var(--yt-text-secondary);}
      .current-shortcut{margin:18px 0;font-size:15px;}
      .current-shortcut kbd{background:var(--yt-button-bg);color:var(--yt-text-primary);padding:5px 12px;border-radius:6px;font-family:monospace;border:1.5px solid var(--yt-glass-border);}
      .shortcut-cancel{display:inline-flex;align-items:center;justify-content:center;gap:var(--yt-space-sm);}
      @media(max-width:480px){.shorts-help-panel{width:98vw;max-height:85vh;padding:10px}.help-content{padding:10px 8px}.help-item{gap:10px}.help-item kbd{min-width:44px;font-size:13px;padding:5px 7px}.shortcut-edit-content{margin:20px;min-width:auto}}
      #shorts-keyboard-feedback{background:var(--yt-glass-bg);color:var(--yt-text-primary);border:1.5px solid var(--yt-glass-border);border-radius:20px;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);}
    `,

    'shorts-download-styles': `
      .yp-shorts-download{width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;z-index:1;cursor:pointer;box-shadow:var(--yt-glass-shadow);background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);margin:0 auto 10px;align-self:center;color:var(--yt-text-primary);transition:background-color .3s cubic-bezier(0.2,0,0,1), color .3s cubic-bezier(0.2,0,0,1), border-color .3s cubic-bezier(0.2,0,0,1), transform .15s cubic-bezier(0.2,0,0,1), box-shadow .3s cubic-bezier(0.2,0,0,1);}
      .yp-shorts-download:active{transform:scale(0.96) !important;}
      .yp-shorts-download svg{width:22px;height:22px;display:block;pointer-events:none;}
      .yp-shorts-download:hover{background:var(--yt-hover-bg);}
      @media(max-width:480px){.yp-shorts-download{width:44px;height:44px;margin-bottom:8px}}
    `,

    'pip-styles': `
      .pip-shortcut-editor { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      .pip-hidden-select { display: none; }
      .pip-submenu-layout { margin-left: 12px; margin-bottom: 12px; }
      .pip-submenu-layout.is-hidden { display: none; }
      .pip-submenu-card { display: flex; flex-direction: column; gap: 8px; }
      .pip-shortcut-item { display: flex; }
      .pip-submenu-toggle-hidden { display: none; }
      .pip-shortcut-editor select, .pip-key-input {background: var(--yt-input-bg); color: var(--yt-text-primary); border: 1px solid var(--yt-glass-border); border-radius: var(--yt-radius-sm); padding: 4px;}
      .pip-key-input { width: 35px; text-align: center; }
    `,
    'timecode-panel-styles': `
      #timecode-panel{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;position:fixed;right:20px;top:80px;background:var(--yt-glass-bg);border-radius:16px;box-shadow:var(--yt-glass-shadow);width:320px;max-height:70vh;z-index:10000;color:var(--yt-text-primary);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1.5px solid var(--yt-glass-border);transition:transform .28s cubic-bezier(.4,0,.2,1),opacity .28s;overflow:hidden;display:flex;flex-direction:column}
      #timecode-panel.hidden{transform:translateX(300px);opacity:0;pointer-events:none}
      #timecode-panel.auto-tracking{box-shadow:0 12px 48px var(--yt-danger-ghost);border-color:var(--yt-danger-border)}
      #timecode-header{display:flex;justify-content:space-between;align-items:center;padding:14px;border-bottom:1px solid var(--yt-surface-overlay-subtle);background:linear-gradient(180deg, var(--yt-surface-overlay-faint), transparent);cursor:move}
      #timecode-title{font-weight:600;margin:0;font-size:15px;user-select:none;display:flex;align-items:center;gap:8px}
      #timecode-tracking-indicator{width:8px;height:8px;background:var(--yt-accent);border-radius:50%;opacity:0;transition:opacity .3s}
      #timecode-panel.auto-tracking #timecode-tracking-indicator{opacity:1}
      #timecode-current-time{font-family:monospace;font-size:12px;padding:2px 6px;background:var(--yt-danger-border);border-radius:3px;margin-left:auto;font-variant-numeric:tabular-nums}
      #timecode-header-controls{display:flex;align-items:center;gap:6px}
      #timecode-reload,#timecode-close{background:transparent;border:none;color:inherit;cursor:pointer;width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:background .18s,color .18s}
      #timecode-header-controls svg{width:16px;height:16px;display:block;flex-shrink:0}
      #timecode-header-controls svg path{vector-effect:non-scaling-stroke}
      #timecode-reload:hover,#timecode-close:hover{background:var(--yt-surface-overlay-subtle)}
      #timecode-reload:active,#timecode-close:active{transform:scale(0.96) !important;}
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
      .timecode-time{font-family:monospace;margin-right:10px;color:var(--yt-text-secondary);font-size:13px;min-width:45px;flex-shrink:0;font-variant-numeric:tabular-nums}
      .timecode-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;flex:1;margin-left:4px}
      .timecode-item:not(:has(.timecode-label)) .timecode-time{flex:1;text-align:left}
      .timecode-item.has-chapter .timecode-time{color:var(--yt-timecode-chapter)}
      .timecode-progress{width:0;height:2px;background:var(--yt-timecode-chapter);position:absolute;bottom:0;left:0;transition:width .3s;opacity:.8}
      .timecode-actions{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;gap:4px;opacity:0;transition:opacity .2s;background:var(--yt-glass-bg);border-radius:4px;padding:2px}
      .timecode-action{background:none;border:none;color:var(--yt-text-secondary);cursor:pointer;padding:4px;font-size:12px;border-radius:2px;transition:color .2s,background-color .2s}
      .timecode-action:hover{color:var(--yt-text-primary);background:var(--yt-button-bg)}
      .timecode-action:active{transform:scale(0.96) !important;}
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
      #timecode-form-cancel:active,#timecode-form-save:active{transform:scale(0.96) !important;}
      #timecode-form-save{background:var(--yt-timecode-chapter);color:#fff}
      #timecode-form-save:hover{background:var(--yt-timecode-active-border)}
      #timecode-actions{padding:10px;border-top:1px solid var(--yt-surface-overlay-subtle);display:flex;gap:8px;background:linear-gradient(180deg,transparent,var(--yt-panel-overlay-subtle))}
      #timecode-actions button{padding:8px 12px;border:none;border-radius:8px;cursor:pointer;font-size:13px;transition:background .18s;color:inherit;background:var(--yt-button-bg)}
      #timecode-export-btn.is-hidden{display:none}
      #timecode-actions button:hover{background:var(--yt-hover-bg)}
      #timecode-actions button:active{transform:scale(0.96) !important;}
      #timecode-track-toggle.active{background:linear-gradient(90deg,var(--yt-timecode-toggle-active-start),var(--yt-timecode-chapter));color:#fff}
      #timecode-empty .timecode-empty-hint{margin-top:5px;font-size:12px}
      .timecode-submenu-layout{margin-left:12px;margin-bottom:12px}
      .timecode-submenu-layout.is-hidden{display:none}
      .timecode-submenu-card{display:flex;flex-direction:column;gap:8px}
      .timecode-shortcut-row{display:flex}
      .timecode-shortcut-editor{display:flex;align-items:center;gap:8px;margin-left:auto}
      .timecode-hidden-select{display:none}
      .timecode-submenu-toggle-hidden{display:none}
      .timecode-shortcut-plus{color:inherit;opacity:.8}
      .timecode-key-input{width:35px;text-align:center;background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-border-color);border-radius:4px;padding:4px}
    `,
    'thumbnail-viewer-styles': `
        .thumbnail-modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--yt-modal-bg); z-index: var(--yt-z-modal); display: flex; align-items: center; justify-content: center; animation: fadeInModal 0.22s cubic-bezier(.4,0,.2,1);  backdrop-filter: var(--yp-scrim-blur); -webkit-backdrop-filter: var(--yp-scrim-blur); }
        .thumbnail-modal-wrapper { position: relative; display: flex; align-items: center; justify-content: center; gap: 16px; }
        .thumbnail-modal-content { background: var(--yt-glass-bg); border-radius: 24px; box-shadow: var(--yt-glass-shadow); max-width: 820px; max-height: 90vh; overflow: hidden; position: relative; display: flex; flex-direction: column; align-items: center; animation: scaleInModal 0.22s cubic-bezier(.4,0,.2,1); border: 1.5px solid var(--yt-glass-border); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); padding: 0; }
        .thumbnail-modal-img { max-width: 800px; max-height: 68vh; border-radius: 22px; display: block; background: #000; box-shadow: none; border: none; }
        .thumbnail-modal-options { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }

        /* Vision mode (default): Floating top pill & vertical action capsule */
        .thumbnail-classic-header,
        .thumbnail-classic-footer {
          display: none !important;
        }
        .vision-top-pill {
          position: absolute;
          top: -46px;
          left: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 14px;
          border-radius: 999px;
          background: var(--yt-glass-bg);
          border: 1.5px solid var(--yt-glass-border);
          backdrop-filter: var(--yt-glass-blur);
          -webkit-backdrop-filter: var(--yt-glass-blur);
          box-shadow: var(--yt-glass-shadow);
          color: var(--yt-text-primary);
          font-size: 12px;
          font-weight: 600;
          z-index: 20;
        }
        .vision-top-pill-red {
          background: var(--yp-accent);
          color: var(--yp-text-on-accent);
          padding: 2px 7px;
          border-radius: var(--yp-r-xs);
          font-size: 10.5px;
          font-weight: 700;
        }
        .thumbnail-modal-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--yt-glass-bg);
          border: 1.5px solid var(--yt-glass-border);
          border-radius: 999px;
          padding: 8px 6px;
          backdrop-filter: var(--yt-glass-blur);
          -webkit-backdrop-filter: var(--yt-glass-blur);
          box-shadow: var(--yt-glass-shadow);
          margin-top: 0;
        }
        .thumbnail-modal-action-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--yt-text-secondary);
          cursor: pointer;
          transition: transform var(--yp-dur-3) var(--yp-ease), background-color var(--yp-dur-3) var(--yp-ease), color var(--yp-dur-3) var(--yp-ease);
          padding: 0;
          line-height: 0;
        }
        .thumbnail-modal-action-btn svg { width: 18px; height: 18px; display: block; flex: none; }
        .thumbnail-modal-action-btn:hover {
          background: var(--yt-hover-bg);
          color: var(--yt-text-primary);
          transform: scale(1.08);
        }
        .thumbnail-modal-download {
          color: var(--yp-accent);
        }
        .thumbnail-modal-download:hover {
          background: var(--yp-accent-soft);
          color: var(--yp-accent);
        }

        /* Classic mode: Refined monolithic window */
        html[data-yp-variant="classic"] .thumbnail-modal-actions,
        html[data-yp-variant="classic"] .thumbnail-classic-footer,
        html[data-yp-variant="classic"] .vision-top-pill {
          display: none !important;
        }
        html[data-yp-variant="classic"] .thumbnail-modal-wrapper {
          max-width: 820px;
          width: fit-content;
          gap: 0;
          display: flex;
          justify-content: center;
          margin: auto;
        }
        html[data-yp-variant="classic"] .thumbnail-modal-content {
          width: 100%;
          max-width: 820px;
          background: var(--yt-glass-bg);
          border: 1.5px solid var(--yt-glass-border);
          border-radius: var(--yp-r-md);
          box-shadow: var(--yt-glass-shadow);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          backdrop-filter: var(--yt-glass-blur);
          -webkit-backdrop-filter: var(--yt-glass-blur);
          padding: 0;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-header {
          display: flex !important;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: var(--yt-panel-bg);
          border-bottom: 1px solid var(--yt-glass-border);
          box-sizing: border-box;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-title-group {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-badge {
          background: var(--yp-accent);
          color: var(--yp-text-on-accent);
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: var(--yp-r-xs);
          letter-spacing: 0.3px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-res-text {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--yt-text-secondary);
          font-variant-numeric: tabular-nums;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-actions {
          display: flex !important;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-btn {
          width: 32px;
          height: 32px;
          padding: 0;
          border-radius: var(--yp-r-sm);
          border: none;
          background: transparent;
          color: var(--yt-text-secondary);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);
        }
        html[data-yp-variant="classic"] .thumbnail-classic-btn svg {
          width: 16px;
          height: 16px;
          display: block;
        }
        html[data-yp-variant="classic"] .thumbnail-classic-btn:hover {
          background: var(--yt-hover-bg);
          color: var(--yt-text-primary);
        }
        html[data-yp-variant="classic"] .thumbnail-classic-download-btn {
          color: var(--yp-accent);
        }
        html[data-yp-variant="classic"] .thumbnail-classic-download-btn:hover {
          background: var(--yp-accent-soft);
          color: var(--yp-accent);
        }
        html[data-yp-variant="classic"] .thumbnail-classic-close-btn:hover {
          background: var(--yp-accent-soft);
          color: var(--yp-accent);
        }
        html[data-yp-variant="classic"] .thumbnail-modal-img {
          max-width: 820px;
          width: 100%;
          height: auto;
          max-height: 65vh;
          object-fit: contain;
          margin: 0 auto;
          padding: 0;
          box-sizing: border-box;
          background: transparent;
          border: none;
          border-radius: 0;
          box-shadow: none;
          display: block;
        }
    `,

    'thumbnail-overlay-styles': `
        .thumbnail-base-overlay{position:absolute;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:1000;opacity:0;transition:opacity 0.2s ease, background-color 0.2s ease, transform 0.1s cubic-bezier(0.2,0,0,1)}
        [data-yp-thumb-host]:hover>.thumbnail-base-overlay{opacity:1}
        .thumbnail-base-overlay:active{transform:scale(0.96) !important;}
        .thumb-overlay,.banner-overlay{bottom:8px;left:8px;border-radius:4px}
        .thumb-overlay{background:var(--yt-thumbnail-overlay-idle)}
        .thumb-overlay:hover{background:var(--yt-thumbnail-overlay-hover)}
        .avatar-overlay{top:50%;left:50%;transform:translate(-50%, -50%);border-radius:50%;background:var(--yt-thumbnail-overlay-hover)}
        .avatar-overlay:hover{background:var(--yt-thumbnail-overlay-active)}
        .banner-overlay{background:var(--yt-thumbnail-overlay-hover)}
        .banner-overlay:hover{background:var(--yt-thumbnail-overlay-active)}
    `,

    'yp-resume-overlay-styles': `
      .yp-resume-overlay{min-width:180px;max-width:36vw;background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:12px 14px;border-radius:12px;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow);border:1.25px solid var(--yt-glass-border);font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;align-items:center;text-align:center;animation:yp-resume-fadein 0.3s ease-out}
      @keyframes yp-resume-fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
      .yp-resume-overlay .yp-resume-title{font-weight:600;margin-bottom:8px;font-size:13px}
      .yp-resume-overlay .yp-resume-btn{padding:6px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:500;transition:background-color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), box-shadow 0.2s cubic-bezier(0.2,0,0,1);outline:none}
      .yp-resume-overlay .yp-resume-btn:focus{box-shadow:0 0 0 2px var(--yt-glass-border);outline:2px solid transparent}
      .yp-resume-overlay .yp-resume-btn:hover{transform:translateY(-1px)}
      .yp-resume-overlay .yp-resume-btn:active{transform:scale(0.96) !important;}
      .yp-resume-overlay .yp-resume-btn.primary{background:var(--yt-accent-secondary);color:#fff}
      .yp-resume-overlay .yp-resume-btn.primary:hover{background:var(--yt-accent-secondary-light)}
      .yp-resume-overlay .yp-resume-btn.ghost{background:var(--yt-button-bg);color:var(--yt-text-primary)}
      .yp-resume-overlay .yp-resume-btn.ghost:hover{background:var(--yt-hover-bg)}
    `,
    'yp-comments-modal-style': `
        .yp-settings-shell{transition:transform .25s cubic-bezier(0.2,0,0,1);}
        .yp-comments-sidepanel{position:fixed;top:10vh;left:calc(50% + 390px);width:min(440px,34vw);max-width:92vw;height:60vh;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:24px;display:none;z-index:100001;box-shadow:var(--yt-glass-shadow);overflow:hidden;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);color:var(--yt-text-primary);contain:layout style paint;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;box-sizing:border-box;}
        .yp-comments-sidepanel.open{display:flex;flex-direction:column;}
        .yp-comments-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;box-sizing:border-box;flex-shrink:0;border-bottom:1px solid var(--yt-glass-border);}
        .yp-comments-title-wrap{display:flex;align-items:baseline;gap:8px;min-width:0;overflow:hidden;}
        .yp-comments-heading{font-size:15px;font-weight:600;white-space:nowrap;color:var(--yt-text-primary);}
        .yp-comments-feature-title{font-size:13px;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;color:var(--yt-text-secondary);}
        .yp-comments-close{flex-shrink:0;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;box-sizing:border-box;padding:0;font-size:15px;transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-secondary);}
        .yp-comments-close:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);transform:scale(1.06);}
        .yp-comments-close:active{transform:scale(0.94) !important;}
        .yp-comments-list{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;}
        .yp-comment-item{padding:12px 14px;box-sizing:border-box;background:var(--yt-surface-overlay-subtle);border:1px solid var(--yt-glass-border);border-radius:var(--yp-r-md);}
        .yp-comment-body{font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word;color:var(--yt-text-primary);}
        .yp-comment-footer{font-size:11px;opacity:0.8;margin-top:6px;color:var(--yt-text-secondary);}
        .yp-comment-images-strip{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;}
        .yp-comment-thumb{width:56px;height:56px;object-fit:cover;border-radius:8px;border:1px solid var(--yt-glass-border);cursor:pointer;transition:transform .15s ease;}
        .yp-comment-thumb:hover{transform:scale(1.04);}
        .yp-comments-loading{display:flex;align-items:center;justify-content:center;padding:28px 16px;font-size:13px;color:var(--yt-text-secondary);opacity:0.75;}
        .yp-comments-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:36px 16px;color:var(--yt-text-secondary);gap:8px;}
        .yp-comments-empty-icon{font-size:28px;opacity:0.6;line-height:1;}
        .yp-comments-empty-text{font-size:13px;max-width:240px;line-height:1.4;opacity:0.8;}
        .yp-comments-error{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:36px 16px;color:var(--yt-text-secondary);gap:10px;}
        .yp-comments-retry{border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-primary);border-radius:999px;padding:6px 18px;font-size:13px;cursor:pointer;transition:background-color .15s ease;}
        .yp-comments-retry:hover{background:var(--yt-hover-bg);}
        .yp-voting-load-more-row{grid-column:1 / -1;display:flex;justify-content:center;align-items:center;padding:10px 0 4px;}
        .yp-voting-load-more{border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-primary);border-radius:999px;padding:8px 22px;font-size:13px;cursor:pointer;transition:background-color .15s ease;align-self:center;height:auto;}
        .yp-voting-load-more:hover{background:var(--yt-hover-bg);}
        .yp-voting-load-more:disabled{opacity:0.5;cursor:default;}
        .yp-comment-composer{padding:12px 16px;box-sizing:border-box;flex-shrink:0;border-top:1px solid var(--yt-glass-border);background:transparent;}
        .yp-composer-box{display:flex;flex-direction:column;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yp-r-lg);padding:10px 12px 8px 14px;box-sizing:border-box;transition:border-color .18s ease,background-color .18s ease,box-shadow .18s ease;}
        .yp-composer-box:focus-within{border-color:var(--yt-border-color);background:var(--yt-hover-bg);}
        .yp-comment-input{width:100%;box-sizing:border-box;min-height:38px;max-height:120px;resize:none;padding:0;margin:0;font-size:13.5px;line-height:1.45;font-family:inherit;outline:none;background:transparent !important;border:none !important;box-shadow:none !important;border-radius:0 !important;color:var(--yt-text-primary);}
        .yp-comment-input::placeholder{color:var(--yt-text-secondary);opacity:0.75;}
        .yp-attachment-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
        .yp-attachment-item{position:relative;width:44px;height:44px;border-radius:var(--yp-r-sm);overflow:hidden;border:1px solid var(--yt-glass-border);}
        .yp-attachment-item img{width:100%;height:100%;object-fit:cover;display:block;}
        .yp-attachment-remove{position:absolute;top:2px;right:2px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,0.75);color:#fff;border:none;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;}
        .yp-composer-bottom-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;}
        .yp-composer-left-actions{display:flex;align-items:center;gap:8px;min-width:0;flex:1;}
        .yp-composer-right-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;}
        .yp-comment-status{font-size:12px;color:var(--yt-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .yp-comment-add-photo-btn{width:auto;height:28px;border-radius:var(--yp-r-md);padding:0 10px;display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;white-space:nowrap;background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:pointer;transition:background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);}
        .yp-comment-add-photo-btn:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);}
        .yp-comment-add-photo-btn:active{transform:scale(0.96);}
        .yp-comment-add-photo-btn svg{display:block;flex-shrink:0;}
        .yp-submit-comment,#yp-comments-submit{width:30px;height:30px;min-width:30px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--yp-accent);border:none;color:var(--yp-text-on-accent);box-shadow:var(--yp-shadow-1);opacity:0.4;transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), opacity var(--yp-dur-2) var(--yp-ease);}
        .yp-submit-comment:hover,#yp-comments-submit:hover{background:var(--yp-accent-strong);box-shadow:var(--yp-shadow-2);transform:scale(1.05);}
        .yp-submit-comment:active,#yp-comments-submit:active{transform:scale(0.95);}
        .yp-submit-comment.active,#yp-comments-submit.active{opacity:1;}
        .yp-submit-comment:disabled,#yp-comments-submit:disabled,.yp-submit-comment[aria-disabled="true"],#yp-comments-submit[aria-disabled="true"]{opacity:0.35;cursor:default;transform:none;box-shadow:none;}
        .yp-submit-comment.active[aria-disabled="false"],#yp-comments-submit.active[aria-disabled="false"]{opacity:1;cursor:pointer;}
        .yp-submit-comment svg,#yp-comments-submit svg{width:15px;height:15px;display:block;fill:currentColor;}
        html[data-yp-variant="classic"] .yp-voting-item-status-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;}
        .yp-voting-comments-icon{border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-secondary);border-radius:999px;min-width:28px;height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1;transition:background-color .2s cubic-bezier(0.2,0,0,1),color .2s cubic-bezier(0.2,0,0,1),border-color .2s cubic-bezier(0.2,0,0,1),transform .1s cubic-bezier(0.2,0,0,1);}
        .yp-voting-comments-icon:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);}
        .yp-voting-comments-icon:active{transform:scale(0.96) !important;}
        .yp-voting-comments-icon svg{width:14px;height:14px;display:block;fill:currentColor;}
        .yp-comments-sidepanel textarea,
        .yp-comments-sidepanel button,
        .yp-comments-sidepanel .yp-comments-item,
        .yp-comments-sidepanel .yp-comments-item-text,
        .yp-comments-sidepanel .yp-comments-item-meta,
        .yp-comments-sidepanel .yp-voting-empty{font-family:inherit;}
        html[data-yp-variant="classic"] .yp-comments-sidepanel{border-radius:14px;}
        html[data-yp-variant="classic"] .yp-comments-close{width:32px;height:32px;background:transparent;border:none;font-size:18px;}
        html[data-yp-variant="classic"] .yp-comments-close:hover{transform:none;}
        html[data-yp-variant="classic"] .yp-comment-item{border-radius:8px;}
        html[data-yp-variant="classic"] .yp-comment-composer{background:var(--yt-panel-bg);}
        html[data-yp-variant="classic"] .yp-composer-box{border-radius:18px;}
    `,
    'yp-playlist-delete-styles': `
      .yp-playlist-search { padding: 8px 16px; background: transparent; border-bottom: 1px solid var(--yt-spec-10-percent-layer); z-index: 50; width: 94%; }
      .yp-playlist-search-input { width: 93%; padding: 8px 16px; border: 1px solid var(--yt-spec-10-percent-layer); border-radius: 20px; background: var(--yt-spec-badge-chip-background); color: var(--yt-text-primary); font-size: 14px; font-family: 'Roboto', Arial, sans-serif; outline: none; transition: border-color 0.2s; }
      .yp-playlist-search-input.is-focused { border-color: var(--yt-spec-call-to-action); }
      .yp-playlist-input-row { display: flex; align-items: center; gap: 6px; }
      .yp-playlist-input-row .yp-playlist-search-input { width: auto; flex: 1; }
      .yp-playlist-delete-toggle { background: transparent; border: 1px solid var(--yt-spec-10-percent-layer); border-radius: 50%; width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: var(--yt-spec-text-secondary); transition: background-color 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1); vertical-align: middle; margin-left: 6px; flex-shrink: 0; }
      .yp-playlist-delete-toggle:active { transform: scale(0.96) !important; }
      .yp-playlist-delete-toggle:hover { color: var(--yt-spec-text-primary); border-color: var(--yt-spec-text-secondary); }
      .yp-playlist-delete-bar { display: none; padding: 6px 0 0; gap: 8px; align-items: center; flex-wrap: wrap; }
      .yp-playlist-delete-bar.is-visible { display: flex; }
      .yp-playlist-selected-count { font-size: 12px; color: var(--yt-spec-text-secondary); margin-right: auto; }
      .yp-playlist-delete-action { padding: 5px 12px; border-radius: 16px; border: 1px solid var(--yt-spec-10-percent-layer); cursor: pointer; font-size: 12px; font-weight: 500; background: var(--yt-spec-badge-chip-background); color: var(--yt-spec-text-primary); transition: background-color 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s cubic-bezier(0.2,0,0,1), color 0.2s cubic-bezier(0.2,0,0,1), transform 0.1s cubic-bezier(0.2,0,0,1); }
      .yp-playlist-delete-action:active { transform: scale(0.96) !important; }
      .yp-playlist-delete-selected { background: var(--yt-search-highlight-bg); border-color: var(--yt-search-highlight-border); color: var(--yt-search-highlight-accent); }
      .yp-playlist-delete-selected:disabled { opacity: 0.5; }
      .yp-playlist-delete-selected:not(:disabled):hover { background: var(--yt-search-highlight-hover) !important; }
      .yp-playlist-select-all:hover, .yp-playlist-clear-all:hover { background: var(--yt-spec-10-percent-layer) !important; }
      .yp-playlist-item-checkbox { position: absolute; top: 8px; left: 8px; z-index: 2; cursor: pointer; opacity: 0.85; transition: opacity 0.15s; }
      .yp-playlist-item-checkbox:hover { opacity: 1; }
    `,
    'yp-download-styles': `
      .yp-download-button{position:relative!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;height:100%!important;vertical-align:top!important;cursor:pointer!important;}
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
      .yp-download-modal-overlay{backdrop-filter:var(--yp-scrim-blur);-webkit-backdrop-filter:var(--yp-scrim-blur);position:fixed;inset:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:999999;}
      .yp-download-modal-shell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;max-width:95vw;animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);}
      .yp-download-modal-box{width:440px;max-width:94vw;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:24px;box-shadow:var(--yt-glass-shadow);font-family:inherit;border:1.5px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);padding:16px 18px 20px 18px;overflow:hidden;box-sizing:border-box;}
      .yp-download-modal-tabs{display:flex;gap:4px;padding:4px;justify-content:center;align-items:stretch;background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:16px;box-sizing:border-box;}
      .yp-download-modal-tab{flex:1;padding:8px 6px;border:none;background:transparent;cursor:pointer;transition:transform var(--yp-dur-3) var(--yp-ease), background-color var(--yp-dur-3) var(--yp-ease), color var(--yp-dur-3) var(--yp-ease);color:var(--yt-text-secondary);border-radius:var(--yp-r-md);outline:none;user-select:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;box-sizing:border-box;}
      .yp-download-tab-title{font-size:13px;font-weight:600;color:inherit;line-height:1.2;}
      .yp-download-tab-sub{font-size:10px;font-weight:500;opacity:0.7;line-height:1;}
      .yp-download-modal-tab:hover{color:var(--yt-text-primary);background:var(--yt-hover-bg);}
      .yp-download-modal-tab.active{background:var(--yt-button-bg);color:var(--yt-text-primary);box-shadow:var(--yt-shadow);}
      .yp-download-modal-tab.active .yp-download-tab-sub{opacity:0.9;}
      .yp-download-modal-tab:active{transform:scale(0.96)!important;}
      .yp-download-modal-content{padding:16px 4px 10px 4px;}
      .yp-download-quality{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0;width:100%;align-items:center;justify-content:center;background:transparent;}
      .yp-download-quality-label{display:flex;align-items:center;gap:12px;width:100%;margin:12px 0 8px 0;}
      .yp-download-quality-label-line{flex:1;border-top:1px solid var(--yt-glass-border);}
      .yp-download-quality-label-text{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:var(--yt-text-secondary);padding:0 4px;}
      .yp-download-pill{padding:8px 14px;border-radius:var(--yp-r-md);border:1px solid var(--yt-glass-border);background:var(--yt-input-bg);color:var(--yt-text-secondary);cursor:pointer;font-size:13px;font-weight:600;transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);}
      .yp-download-pill:hover{background:var(--yt-hover-bg);border-color:var(--yt-border-color);color:var(--yt-text-primary);transform:translateY(-1px);}
      .yp-download-pill.active{background:var(--yt-text-primary);color:var(--yt-solid-bg);border-color:var(--yt-text-primary);box-shadow:var(--yt-shadow);font-weight:700;}
      .yp-download-pill.small{padding:6px 12px;font-size:12px;}
      .yp-download-pill:active{transform:scale(0.96)!important;}
      .yp-download-classic-source-select{display:none;}
      .yp-download-actions-wrap{display:flex;flex:1;gap:12px;}
      .yp-download-form-row{display:flex;gap:12px;padding:12px 4px 0 4px;justify-content:center;}
      .yp-download-btn{flex:1;height:42px;border-radius:var(--yp-r-md);border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-primary);cursor:pointer;font-size:13.5px;font-weight:600;transition:transform var(--yp-dur-3) var(--yp-ease), background-color var(--yp-dur-3) var(--yp-ease);display:flex;align-items:center;justify-content:center;}
      .yp-download-btn:hover{background:var(--yt-hover-bg);transform:translateY(-1px);}
      .yp-download-btn.primary{background:var(--yp-accent);border:1px solid var(--yp-accent);color:var(--yp-text-on-accent);font-weight:700;box-shadow:var(--yp-shadow-2);}
      .yp-download-btn.primary:hover{background:var(--yp-accent-strong);box-shadow:var(--yp-shadow-3);}
      .yp-download-btn:active{transform:scale(0.97)!important;}
      .yp-download-progress{display:none;margin-top:12px;}
      .yp-download-progress-bar{width:100%;height:5px;background:var(--yt-input-bg);border-radius:999px;overflow:hidden;margin-bottom:6px;}
      .yp-download-progress-fill{width:0%;height:100%;background:linear-gradient(90deg,#ff0033,#ff5e3a);box-shadow:0 0 10px rgba(255,0,51,0.5);border-radius:999px;transition:width 200ms linear;}
      .yp-download-progress-text{font-size:12px;color:var(--yt-text-secondary);text-align:center;}
      .yp-download-embed-label{font-size:13px;display:none;align-items:center;justify-content:center;gap:8px;color:var(--yt-text-primary);padding:8px 0;cursor:pointer;}
      .yp-download-subtitle-wrapper{display:none;}
      .yp-download-select-wrap{display:flex;gap:8px;padding:6px 0;width:100%;align-items:center;justify-content:center;background:transparent;}
      .yp-download-source-wrap{display:flex;align-items:center;justify-content:center;box-sizing:border-box;margin:0;padding:0;}
      .yp-download-source-select{background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:999px;padding:4px 6px;gap:4px;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow);display:flex;flex-direction:row;align-items:center;box-sizing:border-box;}
      .yp-download-source-btn{display:flex;align-items:center;justify-content:center;border-radius:999px;padding:6px 14px;border:none;background:transparent;color:var(--yt-text-secondary);font-size:12px;font-weight:600;cursor:pointer;transition:background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);text-align:center;white-space:nowrap;}
      .yp-download-source-btn:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);}
      .yp-download-source-btn.active{background:var(--yp-accent-soft);color:var(--yp-accent);}
      .yp-download-source-btn:active{transform:scale(0.96)!important;}
      .yp-download-source-hint{display:none;font-size:11px;color:var(--yt-text-secondary);text-align:center;padding:0 4px;margin-top:6px;line-height:1.4;}

      /* Download Manager Widget */
      .yp-download-manager{position:fixed;top:24px;right:24px;width:360px;max-width:calc(100vw - 48px);max-height:70vh;background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:var(--yp-r-lg);border:1.5px solid var(--yt-glass-border);box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);z-index:1000000;opacity:0;transform:translateX(120%);transition:opacity .25s ease,transform .25s cubic-bezier(.2,0,0,1);overflow:hidden;display:flex;flex-direction:column;font-family:inherit;}
      .yp-download-manager.visible{opacity:1;transform:translateX(0);}
      .yp-download-manager-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--yt-glass-border);background:transparent;}
      .yp-download-manager-title-wrap{display:flex;align-items:center;gap:10px;}
      .yp-download-manager-title{margin:0;font-size:14px;font-weight:700;color:var(--yt-text-primary);letter-spacing:0.2px;}
      .yp-download-manager-counter{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--yp-accent);color:var(--yp-text-on-accent);line-height:1.2;}
      .yp-download-manager-history-btn,.yp-download-manager-close{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);padding:0;}
      .yp-download-manager-history-btn:hover,.yp-download-manager-close:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);transform:scale(1.08);}
      .yp-download-manager-list{padding:8px 12px;display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow-y:auto;}
      .yp-download-manager-item{padding:12px 14px;background:var(--yt-surface-overlay-subtle);border:1px solid var(--yt-glass-border);border-radius:var(--yp-r-md);display:flex;flex-direction:column;gap:8px;transition:transform var(--yp-dur-3) var(--yp-ease), opacity var(--yp-dur-3) var(--yp-ease);}
      .yp-download-manager-item:last-child{margin-bottom:0;}
      .yp-download-manager-item.removing{opacity:0;transform:translateX(20px);}
      .yp-download-manager-item.completed .yp-download-manager-item-info{color:#22c55e;}
      .yp-download-manager-item.error .yp-download-manager-item-info{color:var(--yt-danger-text);}
      .yp-download-manager-item-header{display:flex;align-items:center;justify-content:space-between;gap:10px;}
      .yp-download-manager-item-filename{flex:1;min-width:0;font-size:13px;font-weight:600;color:var(--yt-text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .yp-download-manager-item-cancel{width:22px;height:22px;border-radius:50%;background:var(--yp-accent-soft);border:none;color:var(--yp-accent);display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);}
      .yp-download-manager-item-cancel:hover{background:var(--yp-accent);color:var(--yp-text-on-accent);transform:scale(1.1);}
      .yp-download-status-icon.success{color:#22c55e;display:flex;align-items:center;}
      .yp-download-manager-item-meta{display:flex;gap:6px;align-items:center;}
      .yp-download-manager-item-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:var(--yp-r-xs);background:var(--yt-button-bg);color:var(--yt-text-secondary);letter-spacing:0.3px;}
      .yp-download-manager-item-badge.badge-video{background:rgba(59,130,246,0.15);color:#60a5fa;}
      .yp-download-manager-item-badge.badge-audio{background:rgba(168,85,247,0.15);color:#c084fc;}
      .yp-download-manager-item-badge.badge-source{background:var(--yp-accent-soft);color:var(--yp-accent);}
      .yp-download-manager-item-progress{position:relative;width:100%;}
      .yp-download-manager-item-progress-bar{width:100%;height:5px;background:var(--yt-input-bg);border-radius:999px;overflow:hidden;}
      .yp-download-manager-item-progress-fill{height:100%;background:linear-gradient(90deg,#ff0033,#ff5e3a);border-radius:999px;box-shadow:0 0 10px rgba(255,0,51,0.5);transition:width .2s linear;}
      .yp-download-manager-item-info{display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--yt-text-secondary);font-variant-numeric:tabular-nums;}
      .yp-download-manager-history{padding:10px 14px;border-top:1px solid var(--yt-glass-border);background:var(--yt-surface-overlay-faint);max-height:240px;overflow-y:auto;}
      .yp-download-manager-history-title{font-size:12px;font-weight:600;color:var(--yt-text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:.03em;}
      .yp-download-manager-history-list{display:flex;flex-direction:column;gap:6px;}
      .yp-download-manager-history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;}
      .yp-download-manager-history-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--yt-text-primary);}
      .yp-download-manager-history-meta{flex-shrink:0;color:var(--yt-text-secondary);font-size:11px;}
      .yp-download-manager-history-status{flex-shrink:0;font-size:10px;text-transform:uppercase;padding:1px 6px;border-radius:4px;border:1px solid var(--yt-glass-border);}
      .yp-download-manager-history-status.status-completed{color:var(--yt-success-accent);border-color:var(--yt-success-accent);}
      .yp-download-manager-history-status.status-error{color:var(--yt-danger-text);border-color:var(--yt-danger-text);}
      .yp-download-manager-history-status.status-cancelled{color:var(--yt-text-secondary);border-color:var(--yt-text-secondary);}
      .yp-download-manager-history-empty{font-size:12px;color:var(--yt-text-secondary);text-align:center;padding:8px 0;}
      @media(max-width:420px){.yp-download-manager{width:calc(100vw - 24px);right:12px;}}
      @media(max-width:360px){.yp-download-manager{width:100vw;right:0;top:0;bottom:auto;max-height:50vh;border-radius:0;border-left:none;border-right:none;}}
    `,
    'yp-enhanced-styles': `
      :root{--yt-scrollbar-width:8px;--yt-scrollbar-track:transparent;--yt-scrollbar-thumb:rgba(144,144,144,.5);--yt-scrollbar-thumb-hover:rgba(170,170,170,.7);--yt-scrollbar-thumb-active:rgba(190,190,190,.9);}
      ::-webkit-scrollbar{width:var(--yt-scrollbar-width)!important;height:var(--yt-scrollbar-width)!important;}
      ::-webkit-scrollbar-track{background:var(--yt-scrollbar-track)!important;border-radius:4px!important;}
      ::-webkit-scrollbar-thumb{background:var(--yt-scrollbar-thumb)!important;border-radius:4px!important;transition:background .2s!important;}
      ::-webkit-scrollbar-thumb:hover{background:var(--yt-scrollbar-thumb-hover)!important;}
      ::-webkit-scrollbar-thumb:active{background:var(--yt-scrollbar-thumb-active)!important;}
      ::-webkit-scrollbar-corner{background:transparent!important;}
      html,body,#content,#guide-content,#secondary,#comments,#chat,ytd-comments,ytd-watch-flexy,ytd-browse,ytd-search,ytd-playlist-panel-renderer,#right-tabs,.tab-content-cld,ytmusic-app-layout{scrollbar-width:thin;scrollbar-color:var(--yt-scrollbar-thumb) var(--yt-scrollbar-track);}
      html[dark]{--yt-scrollbar-thumb:rgba(144,144,144,.4);--yt-scrollbar-thumb-hover:rgba(170,170,170,.6);--yt-scrollbar-thumb-active:rgba(190,190,190,.8);}
      html:not([dark]){--yt-scrollbar-thumb:rgba(60,60,60,.35);--yt-scrollbar-thumb-hover:rgba(60,60,60,.55);--yt-scrollbar-thumb-active:rgba(40,40,40,.75);}
      ytd-watch-flexy[flexy] #movie_player, ytd-watch-flexy[flexy] #movie_player .html5-video-container, ytd-watch-flexy[flexy] .html5-main-video{width:100%!important; max-width:100%!important;}
      ytd-watch-flexy[flexy] .html5-main-video{height:auto!important; max-height:100%!important; object-fit:contain!important; transform:none!important;}
      ytd-watch-flexy[flexy] #player-container-outer, ytd-watch-flexy[flexy] #movie_player{display:flex!important; align-items:center!important; justify-content:center!important;}
      dislike-button-view-model,
      ytd-toggle-button-renderer,
      yt-button-shape,
      ytd-segmented-like-dislike-button-renderer{min-width:fit-content!important;width:auto!important;}
      dislike-button-view-model button{min-width:fit-content!important;width:auto!important;}
      dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;align-items:center!important;justify-content:center!important;}
      #yp-dislike-text{display:inline-block!important;visibility:visible!important;opacity:1!important;}
      #yp-dislike-text.yp-dislike-text--regular{margin-left:6px!important;font-size:1.4rem!important;line-height:2rem!important;font-weight:500!important;min-width:2em!important;text-align:center!important;}
      #yp-dislike-text.yp-dislike-text--shorts{margin-left:4px!important;font-size:1.2rem!important;line-height:1.8rem!important;font-weight:500!important;min-width:1.5em!important;text-align:center!important;}
      ytd-segmented-like-dislike-button-renderer dislike-button-view-model button{min-width:fit-content!important;}
      ytd-segmented-like-dislike-button-renderer .yt-spec-button-shape-next__button-text-content{min-width:2.4rem!important;}
      ytd-reel-video-renderer dislike-button-view-model #yp-dislike-text.yp-dislike-text--shorts{font-size:1.2rem!important;line-height:1.8rem!important;margin-left:4px!important;}
      ytd-reel-video-renderer dislike-button-view-model button{padding:8px 12px!important;min-width:auto!important;}
      ytd-shorts dislike-button-view-model .yt-spec-button-shape-next__button-text-content{display:inline-flex!important;min-width:auto!important;}
      .yp-shorts-dislike-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;margin:0 auto 12px;align-self:center;z-index:1;}
      .yp-shorts-dislike-btn{width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:var(--yt-glass-shadow);background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);color:var(--yt-text-primary);padding:0;transition:background-color .2s ease,color .2s ease,border-color .2s ease,transform .15s ease;}
      .yp-shorts-dislike-btn:hover{background:var(--yt-hover-bg);}
      .yp-shorts-dislike-btn:active{transform:scale(0.96)!important;}
      .yp-shorts-dislike-btn.is-active{color:var(--yt-accent);border-color:var(--yt-accent);}
      .yp-shorts-dislike-btn svg{width:22px;height:22px;display:block;pointer-events:none;}
      .yp-shorts-dislike-wrap #yp-dislike-text.yp-dislike-text--shorts{margin:4px 0 0!important;font-size:12px!important;line-height:16px!important;font-weight:500!important;color:var(--yt-text-primary)!important;text-align:center!important;}
    `,
    'yp-top-button-styles': `
      .top-button{position:fixed;bottom:16px;right:16px;width:40px;height:40px;background:var(--yt-button-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2100;opacity:0;visibility:hidden;transition:opacity .3s cubic-bezier(0.2,0,0,1), visibility .3s cubic-bezier(0.2,0,0,1), background-color .3s cubic-bezier(0.2,0,0,1), transform .15s cubic-bezier(0.2,0,0,1), box-shadow .3s cubic-bezier(0.2,0,0,1), border-color .3s cubic-bezier(0.2,0,0,1);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-shadow);}
      .top-button:hover{background:var(--yt-hover-bg);transform:translateY(-2px) scale(1.07);box-shadow:var(--yt-shadow);}
      .top-button:active{transform:scale(0.96) !important;}
      .top-button:focus{outline:2px solid var(--yt-accent);outline-offset:2px;}
      .top-button.visible{opacity:1;visibility:visible;}
      .top-button svg{transition:transform .2s ease;}
      .top-button:hover svg{transform:translateY(-1px) scale(1.1);}
      html[dark]{--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      html:not([dark]),html:not([dark]){--yt-top-btn-bg:var(--yt-button-bg);--yt-top-btn-color:var(--yt-text-primary);--yt-top-btn-border:var(--yt-glass-border);--yt-top-btn-hover:var(--yt-hover-bg);}
      #right-tabs .top-button{position:absolute;z-index:1000;}
      ytd-watch-flexy:not([tyt-tab^="#"]) #right-tabs .top-button{display:none;}
      ytd-playlist-panel-renderer .top-button{position:absolute;z-index:1000;}
      .dl-subtitle-select{position:relative;width:100%;margin-bottom:var(--yp-s-2);box-sizing:border-box}
      .dl-subtitle-display{display:flex;align-items:center;justify-content:space-between}
      .dl-subtitle-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dl-subtitle-chevron{opacity:.85}
      .dl-subtitle-list{display:none}
      .dl-subtitle-list.is-open{display:block}
      .dl-quality-loading{font-size:13px;color:var(--yt-text-secondary);padding:8px 0}
      .dl-clipboard-proxy{position:fixed;left:-9999px;top:-9999px;opacity:0}
    `,
    'yp-play-all-styles': `.yp-play-all-btn{display:inline-flex;align-items:center;padding:0 12px;height:32px;border-radius:8px;background:linear-gradient(135deg,var(--yt-playall-accent-purple),var(--yt-playall-accent-blue));color:#fff;font-size:1.4rem;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;flex-shrink:0;user-select:none;font-family:Roboto,Arial,sans-serif;letter-spacing:.007em;line-height:1;vertical-align:middle;border:none;outline:none}.yp-play-all-btn:hover{opacity:.85}
.yp-play-all-parent{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.yp-play-all-parent>chip-bar-view-model.ytChipBarViewModelHost{flex:1 1 auto;min-width:0}
 .yp-random-badge-close{font-size:2rem;vertical-align:top;line-height:1;display:inline-block;}`,
    'yp-stats-styles': `.yp-stats-btn{display:flex;align-items:center;justify-content:center;gap:8px}
.yp-stats-icon{width:20px;height:20px;fill:currentColor}
.yp-stats-btn-text{display:flex;align-items:center}
.yp-stats-touch-feedback{border-radius:inherit}
.yp-stats-channel-menu{display:flex;gap:15px;width:360px}
.yp-stats-display-label{display:block;margin-bottom:10px;font-size:16px;font-weight:bold}
.yp-stats-font-label{font-size:16px;font-weight:bold}
.yp-stats-font-value{font-size:14px;margin-bottom:15px}
.yp-stats-spinner{position:absolute;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.yp-stats-change-positive{color:#1ed760}
.yp-stats-change-negative{color:#f3727f}`,
    'yp-music-fab-styles': `.yp-music-fab-side-panel{position:absolute!important;bottom:20px!important;right:20px!important;z-index:1200!important;pointer-events:auto!important;display:flex}
.yp-music-fab{position:fixed;bottom:100px;right:20px;z-index:10000;pointer-events:auto;display:flex}`,
    'yp-basic-critical-styles': `.youtube-enhancer-notification-container{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;z-index:2147483647;pointer-events:none;max-width:calc(100% - 32px);width:100%;box-sizing:border-box;padding:0 16px;}
.youtube-enhancer-notification{position:relative;max-width:700px;width:auto;background:var(--yt-glass-bg);color:var(--yt-text-primary);padding:8px 14px;font-size:13px;border-radius:var(--yt-radius-md);z-index:inherit;transition:opacity .35s,transform .32s;box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);font-weight:500;box-sizing:border-box;display:flex;align-items:center;gap:10px;pointer-events:auto;}
.yp-loop-indicator{position:absolute;height:100%;background:linear-gradient(90deg,var(--yt-accent-secondary-ghost) 0%,var(--yt-accent-secondary-light-ghost) 50%,var(--yt-accent-secondary-ghost) 100%);border-left:2px solid var(--yt-accent-secondary);border-right:2px solid var(--yt-accent-secondary);display:none;pointer-events:none;top:0;z-index:1000;box-shadow:inset 0 0 4px var(--yt-accent-secondary-shadow);}
.yp-settings-button{box-sizing:border-box;width:40px;height:40px;min-width:40px;flex:0 0 auto;background:transparent;border:none;color:var(--yt-text-primary,#fff);cursor:pointer;padding:8px;margin:0 4px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;align-self:center;transition:background-color .2s,transform .2s;}
.yp-settings-button svg{width:24px;height:24px;display:block;}
.yp-settings-button:hover{transform:rotate(30deg);background:var(--yt-glass-bg,rgba(255,255,255,.12));}
ytmusic-nav-bar .yp-settings-button{color:var(--ytmusic-color-icon-active,#fff);}
ytcp-header .yp-settings-button{color:var(--ytcp-icon-color,#606060);}
.yp-settings-button--floating{position:fixed;right:18px;bottom:18px;z-index:100001;margin-right:0;padding:10px;border-radius:999px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yp-mat-thin-blur);-webkit-backdrop-filter:var(--yp-mat-thin-blur);}
.yp-settings-button--floating:hover{transform:translateY(-2px) rotate(30deg);}
@media(max-width:768px){.yp-settings-button--floating{right:12px;bottom:12px;padding:8px;}}
.ytSearchboxComponentInputBox{background:transparent!important;}`,
    'yp-basic-settings-styles': `.yp-settings-modal{backdrop-filter:var(--yp-scrim-blur);-webkit-backdrop-filter:var(--yp-scrim-blur);position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:100000;animation:ytEnhanceFadeIn .25s ease-out;contain:layout style paint;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;}
.yp-settings-shell{width:min(740px,92vw);max-width:92vw;height:auto;min-height:auto;max-height:min(530px,78vh);display:flex;flex-direction:row;align-items:stretch;gap:14px;animation:ytEnhanceScaleIn .28s cubic-bezier(.4,0,.2,1);box-sizing:border-box;}
.yp-settings-sidebar{display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:46px;align-self:stretch;box-sizing:border-box;}
.yp-settings-classic-title{display:none;}
.yp-settings-column{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;height:auto;min-height:0;max-height:min(530px,78vh);box-sizing:border-box;}
.yp-settings-topbar{display:flex;align-items:center;gap:12px;padding:0 2px;min-height:36px;height:36px;flex-shrink:0;}
.yp-settings-title{height:36px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:500;margin:0;padding:0 18px;border-radius:18px;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:default;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),border-color .25s cubic-bezier(.4,0,.2,1);white-space:nowrap;background:var(--yt-glass-bg);line-height:1;text-wrap:balance;}
.yp-settings-active-label{flex:1;font-size:13px;font-weight:700;color:#ffffff;text-align:center;white-space:nowrap;letter-spacing:.14em;text-transform:uppercase;opacity:.92;text-shadow:0 1px 4px rgba(0,0,0,.7),0 2px 10px rgba(0,0,0,.4);user-select:none;text-wrap:balance;}
.yp-settings-panel{background:var(--yt-glass-bg);color:var(--yt-text-primary);border-radius:24px;flex:1;height:auto;min-width:0;min-height:0;max-height:min(480px,calc(78vh - 46px));overflow:hidden;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1.5px solid var(--yt-glass-border);contain:layout style paint;display:flex;flex-direction:column;}
.yp-settings-classic-close{display:none;}
.yp-settings-classic-footer{display:none;}
.yp-settings-classic-sidebar-footer{display:none;}
.yp-settings-side-actions{display:flex;flex-direction:column;gap:10px;padding-top:46px;align-self:flex-start;}
.yp-settings-close{width:36px;height:36px;border-radius:50%;background:var(--yt-glass-bg);border:1px solid var(--yt-surface-active);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px var(--yt-shadow-soft);transition:transform .12s cubic-bezier(.2,0,0,1),background-color .12s cubic-bezier(.2,0,0,1),color .2s;color:var(--yt-text-primary);padding:0;}
.yp-settings-close:hover{transform:translateY(-2px);background:var(--yt-danger-ghost);color:var(--yt-accent);}
.yp-settings-close:active{transform:scale(0.96) !important;}
.yp-settings-nav{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:100%;}
.yp-settings-nav-rail{border:1px solid var(--yt-glass-border);border-radius:28px;background:var(--yt-glass-bg);box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);padding:8px 6px;display:flex;flex-direction:column;gap:6px;}
.yp-settings-nav-item{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;width:40px;height:40px;border-radius:20px;cursor:pointer;transition:transform .2s cubic-bezier(.4,0,.2,1),background-color .2s cubic-bezier(.4,0,.2,1),color .2s cubic-bezier(.4,0,.2,1),box-shadow .2s cubic-bezier(.4,0,.2,1);font-size:11px;border:none;color:var(--yt-text-primary);padding:0;text-align:center;}
.yp-settings-nav-item-label{display:none;}
.yp-settings-nav-item:hover{background:var(--yt-hover-bg);transform:translateY(-1px);}
.yp-settings-nav-item:active{transform:scale(0.96) !important;}
.yp-settings-nav-item.active{background:var(--yt-accent,#ff0033);color:#fff;box-shadow:0 4px 14px rgba(255,0,50,0.35);}
.yp-settings-nav-item svg{width:18px;height:18px;margin-right:0;opacity:.92;transition:opacity .2s,transform .2s;flex-shrink:0;}
.yp-settings-nav-item.active svg{opacity:1;transform:scale(1.05);}
.yp-settings-nav-item:hover svg{transform:scale(1.04);}
.yp-settings-main{flex:1;height:auto;min-height:0;max-height:100%;display:flex;flex-direction:column;overflow:hidden;}
.yp-settings-content{flex:1;height:auto;min-height:0;max-height:min(480px,calc(78vh - 46px));padding:var(--yt-space-md) var(--yt-space-lg);overflow-y:auto;box-sizing:border-box;}
.yp-settings-section{margin-bottom:var(--yt-space-lg);}
.yp-settings-section:last-child{margin-bottom:0;}
.yp-settings-section-title{font-size:16px;font-weight:500;margin-bottom:var(--yt-space-md);color:var(--yt-text-primary);text-wrap:balance;}
.yp-settings-section.hidden{display:none !important;}
.yp-settings-item{display:flex;align-items:center;margin-bottom:var(--yt-space-md);padding:14px 18px;background:transparent;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1);border-radius:var(--yt-radius-md);cursor:pointer;}
.yp-settings-item:last-child{margin-bottom:0;}
.yp-settings-item:hover{background:var(--yt-hover-bg);transform:translateX(6px);box-shadow:0 2px 8px rgba(0,0,0,.1);}
.yp-settings-item-actions{display:flex;align-items:center;gap:10px;margin-left:auto;}
.yp-submenu-toggle{position:relative;width:26px;height:26px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);cursor:pointer;opacity:.9;transition:transform .15s ease,background-color .15s ease,opacity .15s ease;}
.yp-submenu-toggle::after{content:"";position:absolute;top:-7px;left:-7px;right:-7px;bottom:-7px;}
.yp-submenu-toggle:hover{background:var(--yt-hover-bg);transform:scale(1.06);}
.yp-submenu-toggle:active{transform:scale(0.96) !important;}
.yp-submenu-toggle:disabled{opacity:.35;cursor:not-allowed;transform:none;}
.yp-submenu-toggle svg{width:16px;height:16px;transition:transform .15s ease;}
.yp-submenu-toggle[aria-expanded="false"] svg{transform:rotate(-90deg);}
.yp-submenu-toggle[aria-expanded="true"] svg{transform:rotate(0deg);}
.yp-settings-item-label{flex:1;font-size:14px;color:var(--yt-text-primary);}
.yp-settings-item-description{font-size:12px;color:var(--yt-text-secondary);margin-top:4px;text-wrap:pretty;}
.yp-settings-checkbox{appearance:none;-webkit-appearance:none;-moz-appearance:none;width:20px;height:20px;min-width:20px;min-height:20px;margin-left:auto;border:2px solid var(--yt-glass-border);border-radius:50%;background:transparent;display:inline-flex;align-items:center;justify-content:center;transition:transform 250ms cubic-bezier(.4,0,.23,1),background-color 250ms cubic-bezier(.4,0,.23,1),border-color 250ms cubic-bezier(.4,0,.23,1);cursor:pointer;position:relative;flex-shrink:0;color:var(--yt-text-primary);box-sizing:border-box;}
.yp-settings-checkbox:focus-visible{outline:2px solid var(--yt-accent);outline-offset:2px;}
.yp-settings-checkbox:hover{background:var(--yt-hover-bg);transform:scale(1.1);}
.yp-settings-checkbox:active{transform:scale(0.96) !important;}
.yp-settings-checkbox::before{content:"";width:5px;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(45deg);top:6px;left:3px;transition:width 100ms ease 50ms,opacity 50ms;transform-origin:0% 0%;opacity:0;}
.yp-settings-checkbox::after{content:"";width:0;height:2px;background:var(--yt-text-primary);position:absolute;transform:rotate(305deg);top:12px;left:7px;transition:width 100ms ease,opacity 50ms;transform-origin:0% 0%;opacity:0;}
.yp-settings-checkbox:checked{transform:rotate(0deg) scale(1.15);}
.yp-settings-checkbox:checked::before{width:9px;opacity:1;background:var(--yt-text-primary);transition:width 150ms ease 100ms,opacity 150ms ease 100ms;}
.yp-settings-checkbox:checked::after{width:16px;opacity:1;background:var(--yt-text-primary);transition:width 150ms ease 250ms,opacity 150ms ease 250ms;}
.yp-settings-select{margin-left:auto;flex-shrink:0;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);border-radius:8px;color:var(--yt-text-primary);font-size:13px;padding:4px 8px;cursor:pointer;outline:none;transition:border-color .2s;}
.yp-settings-select:focus{border-color:var(--yt-accent,#f00);}
.yp-button{padding:var(--yt-space-sm) var(--yt-space-md);border-radius:18px;border:none;font-size:14px;font-weight:500;cursor:pointer;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),box-shadow .25s cubic-bezier(.4,0,.2,1),color .25s cubic-bezier(.4,0,.2,1);}
.yp-topbar-save{height:36px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;font-size:14px;border-radius:18px;line-height:1;}
.yp-button-primary{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);}
.yp-button-primary:hover{background:var(--yt-accent);color:#fff;box-shadow:0 6px 16px var(--yt-danger-shadow-strong);transform:translateY(-2px);}
.yp-button:active{transform:scale(0.96) !important;}
.update-open-page-btn{padding:12px 16px;font-size:13px;background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);display:inline-flex;align-items:center;justify-content:center;}
.update-open-page-btn svg{stroke:currentColor;}
.update-open-page-btn:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
.yp-settings-item .update-open-page-btn{margin-left:auto;}
.app-icon{fill:var(--yt-text-primary);stroke:var(--yt-text-primary);transition:fill .3s,stroke .3s;}
.about-section-content{display:flex;flex-direction:row;align-items:center;justify-content:center;flex-wrap:nowrap;width:fit-content;max-width:100%;line-height:1;gap:12px;text-align:center;margin:6px auto 12px;}
.about-section-content .app-icon{display:block;flex:0 0 auto;margin:0;}
@media(max-width:768px){.yp-settings-shell{height:auto;min-height:auto;max-height:86vh;flex-direction:column;gap:8px;width:95vw;}
.yp-settings-sidebar{width:100%;max-height:70px;overflow-x:auto;padding-top:0;}
.yp-settings-nav{flex-direction:row;}
.yp-settings-nav-rail{max-width:none;border:none;border-radius:0;background:transparent;box-shadow:none;padding:0;flex-direction:row;display:flex;gap:4px;}
.yp-settings-nav-item{width:40px;height:40px;}
.yp-settings-side-actions{flex-direction:row;padding-top:0;align-self:auto;}
.yp-settings-panel{min-height:0;}
.yp-settings-active-label{display:none;}
.yp-settings-item{padding:10px 12px;}}

/* ============================================================
 * MATERIAL SYSTEM: Solid & Glass Tokens
 * ============================================================
 * Glass (default): translucent material tokens with backdrop blur.
 * Solid: the same tokens, opaque, with every --yp-mat-*-blur set to none.
 * Only YouTube+ surfaces use the material tokens; YouTube's own UI keeps
 * its look in both modes.
 * ============================================================ */

/* ============================================================
 * CLASSIC LAYOUT (data-yp-variant="classic")
 * ============================================================
 * Classic transforms the floating-pods layout into a unified
 * monolithic window layout. Backgrounds & borders use theme tokens.
 * ============================================================ */

html[data-yp-variant="classic"] .yp-settings-shell{
  width:min(740px,92vw);
  max-width:92vw;
  height:550px;
  min-height:550px;
  max-height:85vh;
  gap:0;
  background:var(--yt-glass-bg);
  border-radius:14px;
  border:1.5px solid var(--yt-glass-border);
  box-shadow:var(--yt-glass-shadow);
  backdrop-filter:var(--yt-glass-blur);
  -webkit-backdrop-filter:var(--yt-glass-blur);
  overflow:hidden;
  display:flex;
  flex-direction:row;
  position:relative;
}
html[data-yp-variant="classic"] .yp-settings-sidebar{
  width:220px;
  min-width:220px;
  max-width:220px;
  height:100%;
  background:var(--yt-panel-bg);
  border-right:1px solid var(--yt-glass-border);
  padding:0;
  display:flex;
  flex-direction:column;
  align-items:stretch;
  justify-content:flex-start;
  align-self:stretch;
}
html[data-yp-variant="classic"] .yp-settings-classic-title{
  display:flex;
  align-items:center;
  font-size:16px;
  font-weight:600;
  color:var(--yt-text-primary);
  padding:20px 20px 12px 20px;
  margin:0;
  border-bottom:none;
  letter-spacing:0.2px;
}
html[data-yp-variant="classic"] .yp-settings-nav-rail{
  border:none;
  border-radius:0;
  background:transparent !important;
  box-shadow:none !important;
  padding:4px 0;
  display:flex;
  flex-direction:column;
  gap:2px;
  width:100%;
  flex:1;
  overflow-y:auto;
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
}
html[data-yp-variant="classic"] .yp-settings-classic-sidebar-footer{
  display:flex;
  align-items:center;
  justify-content:center;
  padding:14px 16px;
  border-top:1px solid var(--yt-glass-border);
  background:var(--yt-panel-bg);
  margin-top:auto;
  box-sizing:border-box;
}
html[data-yp-variant="classic"] .yp-settings-nav-item{
  width:100%;
  height:44px;
  padding:0 18px;
  border-radius:0;
  display:flex;
  flex-direction:row;
  align-items:center;
  justify-content:flex-start;
  gap:12px;
  color:var(--yt-text-secondary);
  background:transparent;
  font-size:13.5px;
  font-weight:500;
  text-align:left;
  border-left:3px solid transparent;
  box-sizing:border-box;
}
html[data-yp-variant="classic"] .yp-settings-nav-item-label{
  display:block;
  color:inherit;
  font-size:13.5px;
  font-weight:inherit;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
html[data-yp-variant="classic"] .yp-settings-nav-item:hover{
  background:var(--yt-hover-bg);
  color:var(--yt-text-primary);
  transform:none;
}
html[data-yp-variant="classic"] .yp-settings-nav-item.active{
  background:rgba(255,50,50,0.12);
  color:#ff3333;
  border-left-color:#ff3333;
  box-shadow:none;
  transform:none;
}
html[data-yp-variant="classic"] .yp-settings-nav-item svg{
  width:18px;
  height:18px;
  opacity:0.9;
  margin-right:0;
  flex-shrink:0;
}
html[data-yp-variant="classic"] .yp-settings-column{
  flex:1;
  min-width:0;
  height:100%;
  display:flex;
  flex-direction:column;
  background:transparent;
  gap:0;
}
html[data-yp-variant="classic"] .yp-settings-topbar{display:none !important;}
html[data-yp-variant="classic"] .yp-settings-title{display:none;}
html[data-yp-variant="classic"] .yp-settings-active-label{display:none;}
html[data-yp-variant="classic"] .yp-topbar-save{display:none;}
html[data-yp-variant="classic"] .yp-settings-side-actions{display:none;}
html[data-yp-variant="classic"] .yp-settings-classic-close{
  position:absolute;
  top:14px;
  right:16px;
  display:flex;
  align-items:center;
  justify-content:center;
  width:32px;
  height:32px;
  border-radius:50%;
  background:transparent;
  border:none;
  color:var(--yt-text-secondary);
  cursor:pointer;
  padding:0;
  transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), color var(--yp-dur-2) var(--yp-ease);
  z-index:10;
}
html[data-yp-variant="classic"] .yp-settings-classic-close:hover{
  background:var(--yt-danger-ghost, rgba(255,0,50,0.12));
  color:var(--yt-accent, #ff0033);
  transform:scale(1.08);
}
html[data-yp-variant="classic"] .yp-settings-panel{
  flex:1;
  height:100%;
  max-height:100% !important;
  border:none !important;
  border-radius:0 !important;
  background:transparent !important;
  box-shadow:none !important;
  backdrop-filter:none !important;
  -webkit-backdrop-filter:none !important;
  overflow:hidden;
  display:flex;
  flex-direction:column;
}
html[data-yp-variant="classic"] .yp-settings-content{
  flex:1;
  height:100%;
  max-height:100% !important;
  padding:24px 28px 40px 28px;
  overflow-y:auto;
  box-sizing:border-box;
}
html[data-yp-variant="classic"] .yp-settings-classic-footer{display:none !important;}
html[data-yp-variant="classic"] .yp-classic-save{
  display:flex;
  align-items:center;
  justify-content:center;
  width:100%;
  height:38px;
  padding:0 14px;
  border-radius:var(--yp-r-sm);
  background:var(--yp-accent-strong);
  border:none;
  color:var(--yp-text-on-accent);
  font-size:13px;
  font-weight:600;
  cursor:pointer;
  box-shadow:var(--yp-shadow-1);
  transition:transform var(--yp-dur-2) var(--yp-ease), background-color var(--yp-dur-2) var(--yp-ease), box-shadow var(--yp-dur-2) var(--yp-ease);
  box-sizing:border-box;
}
html[data-yp-variant="classic"] .yp-classic-save:hover{
  background:var(--yp-accent-strong-hover);
  box-shadow:var(--yp-shadow-2);
  transform:translateY(-1px);
}
html[data-yp-variant="classic"] .yp-classic-save:active{
  transform:scale(0.97) !important;
}
.about-section-content h1{margin:0;white-space:nowrap;font-family:'Montserrat',sans-serif;font-size:52px;font-weight:600;line-height:1.05;color:transparent;-webkit-text-stroke-width:1px;-webkit-text-stroke-color:var(--yt-text-stroke);cursor:pointer;transition:color .2s;}
.about-section-content h1:hover{color:var(--yt-accent);-webkit-text-stroke-width:1px;-webkit-text-stroke-color:transparent;}
.style-submenu{margin:4px 0 12px 12px;}
.style-submenu-container{display:flex;flex-direction:column;gap:8px;}
.style-side-videos-submenu{margin-left:12px;margin-bottom:8px;}
.enhanced-submenu,.music-submenu{margin-left:12px;margin-bottom:12px;}
.yp-settings-submenu-card{display:flex;flex-direction:column;gap:8px;}
.screenshot-submenu{margin:4px 0 12px 12px;}
.screenshot-submenu-layout{margin-left:12px;margin-bottom:12px;}
.screenshot-submenu-layout.is-hidden{display:none;}
.screenshot-submenu-card{display:flex;flex-direction:column;gap:8px;}
.screenshot-shortcut-row{display:flex;}
.screenshot-shortcut-editor{display:flex;align-items:center;gap:8px;margin-left:auto;}
.screenshot-hidden-select{display:none;}
.screenshot-submenu-toggle-hidden{display:none;}
.screenshot-shortcut-plus{color:inherit;opacity:.8;}
.screenshot-key-input{width:35px;text-align:center;background:var(--yt-input-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-sm);padding:4px;}
.yp-settings-item--top-gap{margin-top:4px;}
.loop-submenu-compact{margin:0 0 4px 0;}
.loop-hotkeys-row-no-margin{margin-bottom:0;}
.loop-submenu-container{display:flex;flex-direction:column;gap:8px;}
.loop-hotkeys-row{flex-direction:column!important;align-items:stretch!important;gap:6px;}
.loop-hotkeys-info{display:flex;flex-direction:column;gap:4px;}
.loop-hotkeys-fields{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-top:12px;width:100%;}
.loop-hotkey-field{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12px;color:var(--yt-text-secondary);flex:1;min-width:80px;}
.loop-hotkey-field span{text-align:center;width:100%;}
.loop-hotkey-input{width:100%;height:36px;border-radius:8px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);color:var(--yt-text-primary);text-align:center;text-transform:uppercase;}
.loop-hotkey-input:focus{background:var(--yt-hover-bg);}
.yp-about-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:16px 0;}
.yp-about-footer{text-align:center;color:var(--yt-text-secondary);font-size:13px;line-height:1.6;margin-bottom:12px;}
.yp-about-author-link{color:var(--yt-text-primary);text-decoration:none;display:inline-flex;align-items:center;vertical-align:middle;transition:transform .15s ease,color .15s ease;}
.yp-about-author-link:hover{color:var(--yt-spec-static-brand-red,#f03);transform:scale(1.05);}
.yp-about-author-svg{display:inline-block;height:24px;width:auto;vertical-align:middle;margin-left:2px;}
.yp-guide-toggle-btn{position:fixed;right:12px;bottom:12px;z-index:100000;background:var(--yt-spec-call-to-action);color:#fff;border:none;border-radius:8px;padding:8px 10px;box-shadow:0 6px 18px var(--yt-shadow-notification);cursor:pointer;opacity:.95;font-size:13px;}
.yp-settings-panel select,
.yp-settings-panel select option {background: var(--yt-panel-bg) !important; color: var(--yt-text-primary) !important;}
.yp-settings-panel select {-webkit-appearance: menulist !important; appearance: menulist !important; padding: 6px 8px !important; border-radius: 6px !important; border: 1px solid var(--yt-glass-border) !important;}
.yp-theme-item{display:flex;flex-direction:column;align-items:stretch;gap:12px;text-align:left;}
.yp-theme-header{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;}
.yp-theme-header>div:first-child{flex:1;min-width:0;}
.yp-theme-pref-bar{display:inline-flex;align-items:center;gap:0;flex-shrink:0;padding:3px;border-radius:20px;background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);}
.yp-theme-pref-btn{padding:6px 16px;border:none;border-radius:18px;background:transparent;color:var(--yt-text-secondary);font-size:13px;font-weight:500;cursor:pointer;transition:background .18s ease,color .18s ease,box-shadow .18s ease;white-space:nowrap;}
.yp-theme-pref-btn:hover{color:var(--yt-text-primary);}
.yp-theme-pref-btn.active{color:#fff;background:linear-gradient(180deg,var(--yt-danger-card-bg-start),var(--yt-danger-card-bg-end));box-shadow:0 0 0 1px var(--yt-danger-card-inset) inset;}
.yp-theme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;width:100%;box-sizing:border-box;}
.yp-theme-card{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;min-height:164px;padding:16px 14px 14px;border-radius:14px;border:1px solid var(--yt-glass-border);background:var(--yt-hover-bg);color:var(--yt-text-secondary);cursor:pointer;transition:background-color .2s ease,color .2s ease,border-color .2s ease,transform .2s ease,box-shadow .2s ease;box-sizing:border-box;}
.yp-theme-card:hover{background:var(--yt-button-bg);color:var(--yt-text-primary);border-color:var(--yt-border-color);transform:translateY(-2px);}
.yp-theme-card:active{transform:scale(0.98) !important;}
.yp-theme-card.active{color:#fff;background:rgba(255,50,50,0.08);border-color:rgba(255,50,50,0.5);box-shadow:0 0 15px rgba(255,50,50,0.1);}
.yp-theme-card-icon{width:44px;height:44px;margin-bottom:2px;color:var(--yt-text-secondary);transition:color .2s ease,filter .2s ease,transform .2s ease;display:flex;align-items:center;justify-content:center;}
.yp-theme-card:hover .yp-theme-card-icon{color:var(--yt-text-primary);transform:translateY(-2px);}
.yp-theme-card.active .yp-theme-card-icon{color:#ff3333;filter:drop-shadow(0 0 12px rgba(255,50,50,0.5));transform:translateY(-2px);}
.yp-theme-card-icon svg{width:100%;height:100%;display:block;}
.yp-theme-card-title{font-size:14px;font-weight:600;letter-spacing:0.3px;color:var(--yt-text-primary);}
.yp-theme-card-desc{font-size:11px;color:var(--yt-text-secondary);font-weight:400;text-align:center;line-height:1.35;transition:color .2s ease;}
.yp-theme-card:hover .yp-theme-card-desc{color:var(--yt-text-primary);}
.yp-theme-style-bar{display:inline-flex;align-items:center;padding:2px;border-radius:14px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);margin-top:6px;gap:2px;z-index:2;}
.yp-theme-style-btn{padding:4px 12px;border:none;border-radius:12px;background:transparent;color:var(--yt-text-secondary);font-size:11.5px;font-weight:500;cursor:pointer;transition:background .15s ease,color .15s ease;white-space:nowrap;}
.yp-theme-style-btn:hover{color:var(--yt-text-primary);}
.yp-theme-style-btn.active{color:#fff;background:linear-gradient(180deg,var(--yt-danger-card-bg-start),var(--yt-danger-card-bg-end));box-shadow:0 0 0 1px var(--yt-danger-card-inset) inset;}
.yp-settings-voting-header{margin-bottom:var(--yt-space-lg);}
.yp-settings-voting-header h3{font-size:18px;font-weight:500;margin:0 0 8px 0;color:var(--yt-text-primary);}
.yp-settings-voting-desc{font-size:13px;color:var(--yt-text-secondary);margin:0;}
.yp-voting{display:flex;flex-direction:column;gap:12px;}
.yp-voting-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.yp-voting-list{display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;padding-bottom:32px;}
.yp-voting-item{display:flex;flex-direction:column;justify-content:space-between;padding:14px 14px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:16px;min-height:165px;box-sizing:border-box;gap:10px;transition:background-color .2s ease,transform .2s ease,border-color .2s ease,box-shadow .2s ease;}
.yp-voting-item:hover{background:var(--yt-hover-bg);border-color:var(--yt-surface-border-strong);transform:translateY(-2px);}
.yp-voting-item-header{display:flex;align-items:center;justify-content:space-between;}
.yp-voting-item-content{flex:1;padding-right:0;display:flex;flex-direction:column;gap:4px;}
.yp-voting-item-title{font-size:14px;font-weight:600;color:var(--yt-text-primary);line-height:1.3;margin-bottom:2px;}
.yp-voting-item-desc{font-size:12px;color:var(--yt-text-secondary);line-height:1.4;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
.yp-voting-item-status-row{display:none;}
.yp-voting-item-status{font-size:11px;min-height:24px;padding:0 9px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:var(--yt-surface-overlay-soft);color:var(--yt-text-secondary);border:1px solid var(--yt-glass-border);line-height:1;}
.yp-voting-item-status.completed,.yp-voting-item-status.status-completed{background:var(--yt-success-soft);color:var(--yt-success);}
.yp-voting-item-status.in-progress,.yp-voting-item-status.status-in_progress,.yp-voting-item-status.status-in-progress{background:var(--yt-warning-soft);color:var(--yt-warning);}
.yp-voting-item-votes{display:flex;align-items:center;justify-content:space-between;width:100%;box-sizing:border-box;margin-top:auto;padding-top:6px;border-top:1px solid var(--yt-glass-border);min-width:0;}
.yp-voting-pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);gap:6px;}
.yp-voting-score{display:flex;align-items:center;gap:4px;justify-content:center;}
.yp-vote-total{font-size:12.5px;font-weight:600;color:var(--yt-text-primary);padding:0 2px;}
.yp-voting-pill .yp-vote-bar-divider{width:1px;height:14px;background:var(--yt-glass-border);flex-shrink:0;}
.yp-voting-buttons{position:relative;display:flex;justify-content:center;gap:0;border:1px solid var(--yt-glass-border);border-radius:20px;overflow:hidden;}
.yp-voting-buttons-track,.yp-vote-bar-track{position:absolute;top:0;left:0;width:100%;height:100%;z-index:0;transition:background .4s ease,opacity .2s ease;background:linear-gradient(to right, var(--yt-success) 50%, var(--yt-danger) 50%);border-radius:20px;opacity:0.65;pointer-events:none;}
html[data-yp-style="solid"] .yp-voting-buttons-track,html[data-yp-variant="solid"] .yp-voting-buttons-track,html[data-yp-style="solid"] .yp-vote-bar-track,html[data-yp-variant="solid"] .yp-vote-bar-track{opacity:1;}
.yp-vote-btn{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:30px;height:24px;border:none;background:transparent;cursor:pointer;transition:color .15s ease,opacity .15s ease,transform .1s cubic-bezier(0.2,0,0,1);color:var(--yt-text-secondary);opacity:.95;}
.yp-vote-btn:first-of-type{border-right:1px solid var(--yt-glass-border);}
.yp-vote-btn:hover{color:var(--yt-text-primary);opacity:1;}
.yp-vote-btn:active{transform:scale(0.96) !important;}
.yp-vote-btn.active{color:#fff;opacity:1;}
html:not([dark]) .yp-vote-btn.active{color:var(--yt-accent,#ff0033);}
.yp-vote-icon{width:15px;height:15px;fill:currentColor;opacity:.92;}
.yp-vote-btn.active .yp-vote-icon,.yp-vote-btn:hover .yp-vote-icon{opacity:1;}
.yp-voting-pill .yp-voting-comments-icon{background:transparent;border:none;border-radius:0;min-width:0;height:auto;padding:0 2px;font-size:11.5px;cursor:pointer;color:var(--yt-text-secondary);display:inline-flex;align-items:center;gap:4px;line-height:1;}
.yp-voting-pill .yp-voting-comments-icon:hover{background:transparent;color:var(--yt-text-primary);}
.yp-voting-pill .yp-voting-comments-icon:active{transform:scale(0.96) !important;}
.yp-feature-thumbs-strip{display:flex;gap:6px;margin-top:6px;overflow-x:auto;}
.yp-feature-thumb{width:48px;height:36px;border-radius:6px;object-fit:cover;cursor:pointer;border:1px solid var(--yt-glass-border);}
html[data-yp-variant="classic"] .yp-voting-list{display:flex;flex-direction:column;gap:12px;}
html[data-yp-variant="classic"] .yp-voting-item{display:flex;flex-direction:row;align-items:flex-start;justify-content:space-between;padding:16px;min-height:auto;border-radius:var(--yt-radius-md);gap:12px;}
html[data-yp-variant="classic"] .yp-voting-item:hover{background:var(--yt-hover-bg);transform:translateX(4px);border-color:var(--yt-glass-border);}
html[data-yp-variant="classic"] .yp-voting-item-header{display:none;}
html[data-yp-variant="classic"] .yp-voting-item-content{padding-right:16px;display:block;}
html[data-yp-variant="classic"] .yp-voting-item-title{font-size:14px;font-weight:500;color:var(--yt-text-primary);margin-bottom:4px;line-height:normal;}
html[data-yp-variant="classic"] .yp-voting-item-desc{font-size:12px;color:var(--yt-text-secondary);line-height:1.4;display:block;overflow:visible;}
html[data-yp-variant="classic"] .yp-voting-item-status-row{display:flex;align-items:center;gap:8px;margin-top:8px;}
html[data-yp-variant="classic"] .yp-voting-item-status{min-height:28px;padding:0 10px;}
html[data-yp-variant="classic"] .yp-voting-item-votes{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:120px;width:auto;margin-top:0;padding-top:0;border-top:none;}
html[data-yp-variant="classic"] .yp-voting-item-votes > .yp-voting-item-status{display:none;}
html[data-yp-variant="classic"] .yp-voting-pill{display:flex;flex-direction:column;align-items:center;background:transparent;border:none;padding:0;gap:8px;}
html[data-yp-variant="classic"] .yp-voting-pill .yp-vote-bar-divider,html[data-yp-variant="classic"] .yp-voting-pill > .yp-voting-comments-icon{display:none;}
html[data-yp-variant="classic"] .yp-vote-total{font-size:12px;color:var(--yt-text-secondary);font-weight:normal;text-align:center;padding:0;}
html[data-yp-variant="classic"] .yp-vote-btn{width:42px;height:32px;}
html[data-yp-variant="classic"] .yp-vote-icon{width:20px;height:20px;}
.yp-voting-loading,.yp-voting-empty{text-align:center;padding:24px;color:var(--yt-text-secondary);font-size:13px;}
.yp-voting-load-more-row{grid-column:1 / -1;display:flex;justify-content:center;align-items:center;padding:10px 0 4px;}
.yp-voting-load-more{border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);color:var(--yt-text-primary);border-radius:999px;padding:8px 22px;font-size:13px;cursor:pointer;transition:background-color .15s ease;align-self:center;height:auto;}
.yp-voting-load-more:hover{background:var(--yt-hover-bg);}
.yp-voting-load-more:disabled{opacity:0.5;cursor:default;}
.yp-voting-header{display:flex;align-items:center;justify-content:space-between;margin-top:8px;margin-bottom:0;}
.yp-voting-header-title{font-size:15px;font-weight:600;color:var(--yt-text-primary);letter-spacing:0.2px;}
.yp-voting-add-btn{background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);padding:7px 18px;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .15s ease;}
.yp-voting-add-btn:hover{background:var(--yt-hover-bg);border-color:var(--yt-surface-border-strong);transform:translateY(-1px);}
.yp-voting-add-btn:active{transform:scale(0.96) !important;}
.yp-voting-add-form{margin:0;padding:16px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);box-sizing:border-box;display:flex;flex-direction:column;gap:12px;}
.yp-voting-add-form input,.yp-voting-add-form textarea{display:block;width:100%;padding:10px 14px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);border-radius:10px;color:var(--yt-text-primary);font-size:13.5px;box-sizing:border-box;font-family:inherit;transition:border-color .15s ease;}
.yp-voting-add-form input:focus,.yp-voting-add-form textarea:focus{border-color:var(--yt-accent,#ff3333);outline:none;}
.yp-voting-add-form textarea{min-height:80px;resize:vertical;}
.yp-feature-title-row{display:flex;gap:8px;align-items:center;width:100%;}
.yp-feature-title-row input{flex:1;min-width:0;}
.yp-add-photo-btn{flex-shrink:0;width:38px;height:38px;box-sizing:border-box;border-radius:10px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-primary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,transform .15s ease;}
.yp-add-photo-btn:hover{background:var(--yt-hover-bg);border-color:var(--yt-surface-border-strong);}
.yp-add-photo-btn:active{transform:scale(0.96) !important;}
.yp-add-photo-btn svg{width:18px;height:18px;fill:currentColor;}
.yp-photo-preview-wrap{position:relative;width:100%;height:180px;border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.2);border:1px solid var(--yt-glass-border);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,0.15);}
.yp-photo-preview-img{width:100%;height:100%;object-fit:contain;display:block;user-select:none;}
.yp-photo-nav-btn{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.55);backdrop-filter:var(--yp-mat-thin-blur);-webkit-backdrop-filter:var(--yp-mat-thin-blur);border:1px solid rgba(255,255,255,0.2);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;transition:background-color .15s ease,transform .15s ease;z-index:5;}
.yp-photo-nav-btn:hover{background:rgba(0,0,0,0.8);transform:translateY(-50%) scale(1.08);}
.yp-photo-nav-btn:active{transform:translateY(-50%) scale(0.95);}
.yp-photo-nav-prev{left:10px;}
.yp-photo-nav-next{right:10px;}
.yp-photo-indicator{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);backdrop-filter:var(--yp-mat-thin-blur);-webkit-backdrop-filter:var(--yp-mat-thin-blur);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.5px;z-index:5;pointer-events:none;}
.yp-photo-top-actions{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:6;}
.yp-photo-action-btn{width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,0.6);backdrop-filter:var(--yp-mat-thin-blur);-webkit-backdrop-filter:var(--yp-mat-thin-blur);border:1px solid rgba(255,255,255,0.2);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:14px;transition:background-color .15s ease,transform .15s ease;}
.yp-photo-action-btn:hover{background:rgba(0,0,0,0.85);transform:scale(1.08);}
.yp-photo-action-btn.delete:hover{background:#ff0033;}
.yp-voting-form-actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;}
.yp-voting-cancel{background:transparent;border:1px solid var(--yt-glass-border);color:var(--yt-text-secondary);padding:7px 16px;border-radius:999px;font-size:12.5px;cursor:pointer;transition:color .15s ease,background-color .15s ease;}
.yp-voting-cancel:hover{color:var(--yt-text-primary);background:var(--yt-hover-bg);}
.yp-voting-cancel:active{transform:scale(0.96) !important;}
.yp-voting-submit{background:var(--yt-accent,#ff0033);color:#fff;border:none;padding:7px 20px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;transition:background-color .15s ease,transform .15s ease;}
.yp-voting-submit:hover{transform:translateY(-1px);background:var(--yt-accent-hover,#e60000);}
.yp-voting-submit:active{transform:scale(0.96) !important;}
@media (max-width: 680px){.yp-voting-list{grid-template-columns:1fr;}.yp-voting-item{flex-direction:column;align-items:stretch;}.yp-voting-item-content{padding-right:0;}.yp-voting-item-votes{min-width:0;width:100%;}}
.yp-voting-preview{margin-bottom:4px;}
.yp-preview-card{position:relative;width:100%;}
.yp-ba-container{position:relative;width:100%;height:260px;overflow:hidden;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);user-select:none;cursor:ew-resize;background:var(--yt-glass-bg);}
.yp-ba-before,.yp-ba-after{position:absolute;top:0;left:0;width:100%;height:100%;overflow:hidden;}
.yp-ba-before img,.yp-ba-after img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;}
.yp-ba-after{clip-path:inset(0 0 0 50%);}
.yp-ba-divider{position:absolute;top:0;left:50%;transform:translateX(-50%);width:8px;height:100%;background:transparent;pointer-events:auto;z-index:3;cursor:ew-resize;transition:left .6s linear}
.yp-ba-divider::after{content:'';position:absolute;left:50%;top:0;transform:translateX(-50%);width:2px;height:100%;background:var(--yt-accent,#f00);}
.yp-ba-handle{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:50%;background:#fff;border:2px solid var(--yt-accent,#f00);box-shadow:0 2px 8px rgba(0,0,0,0.4);pointer-events:none;}
.yp-ba-divider.autoplay{animation:ypSlideDivider 6s linear infinite}
.yp-ba-after.autoplay{animation:ypSlideClip 6s linear infinite}
@keyframes ypSlideDivider{0%{left:10%}50%{left:90%}100%{left:10%}}
@keyframes ypSlideClip{0%{clip-path:inset(0 0 0 10%)}50%{clip-path:inset(0 0 0 90%)}100%{clip-path:inset(0 0 0 10%)}}
.yp-ba-label{position:absolute;top:10px;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:var(--yt-overlay-strong);pointer-events:none;z-index:5;}
.yp-ba-label-before{left:10px;}
.yp-ba-label-after{right:10px;}
.yp-vote-bar-section{margin-top:12px;display:flex;flex-direction:column;align-items:center;gap:6px;}
.yp-vote-bar-row{display:inline-flex;align-items:center;justify-content:center;padding:3px 6px;border-radius:999px;background:var(--yt-input-bg);border:1px solid var(--yt-glass-border);gap:8px;}
.yp-vote-bar-count{font-size:13px;font-weight:600;color:var(--yt-text-primary);padding:0 6px;line-height:1;}
.yp-vote-bar-divider{width:1px;height:18px;background:var(--yt-glass-border);flex-shrink:0;}
.yp-vote-bar-buttons{position:relative;display:flex;gap:0;border-radius:20px;overflow:hidden;border:1px solid var(--yt-glass-border);}
.yp-vote-bar-btn{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;padding:6px 14px;background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;transition:color .15s;font-size:14px;}
.yp-vote-bar-btn:first-of-type{border-right:1px solid var(--yt-glass-border);}
.yp-vote-bar-btn:hover{color:var(--yt-text-primary);}
.yp-vote-bar-btn.active{color:#fff;}
.yp-vote-bar-btn svg{fill:currentColor;width:18px;height:18px;display:block;}
.yp-vote-bar-btn svg path{fill:currentColor;}
.yp-vote-bar-row .yp-voting-comments-icon{border:none;background:transparent;color:var(--yt-text-secondary);padding:6px 12px;height:auto;border-radius:999px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;cursor:pointer;transition:color .15s,background .15s;}
.yp-vote-bar-row .yp-voting-comments-icon:hover{color:var(--yt-text-primary);background:var(--yt-hover-bg);}
html[data-yp-variant="classic"] .yp-vote-bar-row{display:flex;flex-wrap:wrap;background:transparent;border:none;padding:0;gap:8px;border-radius:0;}
html[data-yp-variant="classic"] .yp-vote-bar-divider{display:none;}
html[data-yp-variant="classic"] .yp-vote-bar-buttons{order:1;}
html[data-yp-variant="classic"] .yp-vote-bar-btn{padding:8px 18px;}
html[data-yp-variant="classic"] .yp-vote-bar-btn svg{width:20px;height:20px;}
html[data-yp-variant="classic"] .yp-vote-bar-row .yp-voting-comments-icon{order:2;border:1px solid var(--yt-glass-border);background:var(--yt-button-bg);height:34px;padding:0 12px;}
html[data-yp-variant="classic"] .yp-vote-bar-count{order:3;width:100%;text-align:center;font-size:12px;font-weight:400;color:var(--yt-text-secondary);margin-top:2px;padding:0;}`,
    'yp-player-surface-styles': `/* ============================================================
 * VISION TOP FLOATING DOCK (.vision-top-center-dock)
 * ============================================================ */
.vision-top-center-dock {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--yt-glass-bg);
  border: 1px solid var(--yt-glass-border);
  backdrop-filter: var(--yt-glass-blur);
  -webkit-backdrop-filter: var(--yt-glass-blur);
  box-shadow: var(--yt-glass-shadow);
  z-index: 2100;
  color: var(--yt-text-primary);
  transition: opacity .2s ease, transform .2s ease;
}
.vision-dock-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform var(--yp-dur-3) var(--yp-ease), background-color var(--yp-dur-3) var(--yp-ease);
}
.vision-dock-btn svg {
  width: 18px;
  height: 18px;
}
.vision-dock-btn:hover {
  background: var(--yt-hover-bg);
  transform: scale(1.08);
  color: var(--yt-accent, #ff0033);
}
.vision-dock-btn:active {
  transform: scale(0.96) !important;
}

/* Autohide integration */
.ytp-autohide .vision-top-center-dock,
.ytp-hide-controls .vision-top-center-dock {
  opacity: 0 !important;
  transform: translate(-50%, -10px) !important;
  pointer-events: none !important;
}

/* Layout variant switching */
html[data-yp-variant="classic"] .vision-top-center-dock {
  display: none !important;
}
html[data-yp-variant="vision"] .ytp-right-controls .yp-download-button,
html[data-yp-variant="vision"] .ytp-right-controls .speed-control-btn,
html[data-yp-variant="vision"] .ytp-right-controls .yp-thumbnail-button,
html[data-yp-variant="vision"] .ytp-right-controls .yp-zoom-button,
html[data-yp-variant="vision"] .ytp-right-controls .yp-loop-button,
html[data-yp-variant="vision"] .ytp-right-controls .yp-screenshot-button,
html[data-yp-variant="vision"] .ytp-right-controls .videoStats,
html[data-yp-variant="vision"] .ytp-right-controls .yp-stats-button {
  display: none !important;
}

/* Zoom popover styling in design system */
#yp-zoom-control {
  position: absolute;
  z-index: 2200 !important;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--yt-glass-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-primary);
  font-size: 12px;
  box-shadow: var(--yt-glass-shadow);
  backdrop-filter: var(--yt-glass-blur);
  -webkit-backdrop-filter: var(--yt-glass-blur);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px);
  transition: opacity .2s ease, transform .2s ease;
}
#yp-zoom-control.visible,
.ytp-autohide #yp-zoom-control.visible,
.ytp-hide-controls #yp-zoom-control.visible {
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: translate(-50%, 0) !important;
}
#yp-zoom-control input[type=range] {
  width: 100px;
  -webkit-appearance: none;
  background: transparent;
  height: 24px;
  outline: none;
}
#yp-zoom-control input[type=range]::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--yt-border-color);
  border-radius: 2px;
}
#yp-zoom-control input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--yt-text-primary);
  cursor: pointer;
  margin-top: -4px;
}
#yp-zoom-control input[type=range]::-moz-range-track {
  height: 4px;
  background: var(--yt-border-color);
  border-radius: 2px;
}
#yp-zoom-control input[type=range]::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--yt-text-primary);
  border: none;
  cursor: pointer;
}
#yp-zoom-control .zoom-label {
  min-width: 36px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  padding: 0 4px;
  user-select: none;
  font-variant-numeric: tabular-nums;
}
#yp-zoom-control .zoom-reset {
  background: var(--yt-button-bg);
  border: none;
  color: inherit;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  width: 24px;
  height: 24px;
  transition: background-color .15s, transform .15s;
}
#yp-zoom-control .zoom-reset:hover {
  background: var(--yt-hover-bg);
  transform: scale(1.08);
}
#yp-zoom-control .zoom-reset svg {
  display: block;
  width: 13px;
  height: 13px;
}

/* ============================================================
   Loop Indicators & Popovers (Vision & Classic)
   ============================================================ */
.yp-loop-indicator {
  position: absolute;
  top: 0;
  height: 100%;
  pointer-events: none;
  z-index: 20;
  box-shadow: inset 0 0 4px rgba(62, 166, 255, 0.5);
  background: linear-gradient(90deg, rgba(62, 166, 255, 0.25) 0%, rgba(62, 166, 255, 0.45) 50%, rgba(62, 166, 255, 0.25) 100%);
  border-left: 2px solid var(--yt-accent-secondary, #3ea6ff);
  border-right: 2px solid var(--yt-accent-secondary, #3ea6ff);
}

/* Vision Mode: Segmented Capsule Switch Badges */
.yp-loop-bubble-a.vision-loop-bubble,
.yp-loop-bubble-b.vision-loop-bubble {
  position: absolute;
  bottom: 16px;
  transform: translateX(-50%);
  background: var(--yt-glass-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-primary);
  border-radius: 999px;
  box-shadow: var(--yt-glass-shadow);
  backdrop-filter: var(--yt-glass-blur);
  -webkit-backdrop-filter: var(--yt-glass-blur);
  display: inline-flex;
  align-items: center;
  padding: 2px 7px 2px 2px;
  gap: 6px;
  z-index: 25;
  pointer-events: none;
  white-space: nowrap;
  user-select: none;
}
.vision-loop-bubble .yp-loop-badge-pill {
  background: var(--yt-accent, #ff0033);
  color: #ffffff;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(255, 0, 51, 0.35);
  line-height: 1;
}
.vision-loop-bubble .yp-loop-badge-time {
  font-size: 11px;
  font-weight: 600;
  color: inherit;
  font-variant-numeric: tabular-nums;
  opacity: 0.95;
}
.vision-loop-bubble .yp-loop-bubble-tail {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid var(--yt-glass-border);
}

/* Classic Mode: Variant 4 Flag Pin with Needle Marker */
.yp-loop-bubble-a.classic-loop-bubble,
.yp-loop-bubble-b.classic-loop-bubble {
  position: absolute;
  bottom: 2px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 25;
  pointer-events: none;
  white-space: nowrap;
  user-select: none;
}
.classic-loop-bubble .yp-loop-classic-flag {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--yt-solid-bg);
  border: 1.5px solid var(--yt-accent-secondary, #38bdf8);
  border-radius: 5px;
  padding: 2px 7px;
  color: var(--yt-text-primary);
  font-size: 11px;
  font-weight: 600;
  box-shadow: var(--yt-shadow);
}
.classic-loop-bubble .yp-loop-classic-flag-letter {
  color: var(--yt-accent-secondary, #38bdf8);
  font-weight: 800;
  line-height: 1;
}
.classic-loop-bubble .yp-loop-classic-flag-time {
  color: var(--yt-text-primary);
  font-variant-numeric: tabular-nums;
}
.classic-loop-bubble .yp-loop-classic-needle {
  width: 2px;
  height: 8px;
  background: var(--yt-accent-secondary, #38bdf8);
  margin: 0 auto;
  box-shadow: 0 0 6px var(--yt-accent-secondary, #38bdf8);
}

/* Vision Top Dock Loop Popover */
#yp-vision-loop-pill {
  position: absolute;
  top: 62px;
  bottom: auto;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  background: var(--yt-glass-bg);
  border: 1px solid var(--yt-glass-border);
  backdrop-filter: var(--yt-glass-blur);
  -webkit-backdrop-filter: var(--yt-glass-blur);
  box-shadow: var(--yt-glass-shadow);
  z-index: 2200;
  color: var(--yt-text-primary);
  opacity: 0;
  pointer-events: none;
  transition: opacity .2s ease, transform .2s ease;
  user-select: none;
}
#yp-vision-loop-pill.visible {
  opacity: 1;
  pointer-events: auto;
}
.yp-vision-loop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}
.yp-vision-loop-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  background: var(--yt-button-bg);
  color: var(--yt-text-primary);
  border: 1px solid var(--yt-glass-border);
  border-radius: 999px;
  padding: 0 12px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .12s ease;
}
.yp-vision-loop-toggle-btn:hover {
  background: var(--yt-hover-bg);
}
.yp-vision-loop-toggle-btn:active {
  transform: scale(0.96);
}
.yp-vision-loop-toggle-btn.is-active {
  background: var(--yt-accent, #ff0033);
  color: #ffffff;
  border-color: var(--yt-accent, #ff0033);
  box-shadow: 0 2px 10px rgba(255, 0, 51, 0.28);
}
.yp-vision-reset-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--yt-button-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color .15s ease, color .15s ease, transform .18s ease, border-color .15s ease;
  padding: 0;
  flex-shrink: 0;
}
.yp-vision-reset-btn:hover {
  background: var(--yt-hover-bg);
  color: var(--yt-text-primary);
  transform: rotate(-35deg) scale(1.05);
}
.yp-vision-reset-btn:active {
  transform: scale(0.94);
}
.yp-vision-loop-cards {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.yp-vision-loop-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 7px;
  width: 168px;
  min-width: 168px;
  padding: 8px;
  border-radius: 13px;
  background: var(--yt-surface-overlay-subtle);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  box-sizing: border-box;
  transition: background-color .16s ease, border-color .16s ease, transform .16s ease, box-shadow .16s ease;
}
.yp-vision-loop-card:hover {
  background: var(--yt-hover-bg);
  border-color: var(--yt-surface-border-strong);
  transform: translateY(-1px);
  box-shadow: var(--yt-shadow);
}
.yp-vision-loop-card:active {
  transform: scale(0.98);
}
.yp-vision-loop-card.has-point {
  border-color: rgba(255, 0, 51, 0.38);
}
.yp-vision-loop-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.yp-vision-loop-card-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
}
.yp-vision-set-btn-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--yt-button-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-primary);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  line-height: 1;
}
.yp-vision-loop-card.has-point .yp-vision-set-btn-tag {
  background: rgba(255, 0, 51, 0.14);
  border-color: rgba(255, 0, 51, 0.36);
  color: var(--yt-accent, #ff0033);
}
.yp-vision-loop-card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--yt-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.yp-vision-set-btn-val {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--yt-text-primary);
  font-variant-numeric: tabular-nums;
  background: var(--yt-input-bg);
  border: 1px solid var(--yt-glass-border);
  border-radius: 6px;
  padding: 2px 6px;
  line-height: 1.1;
  flex-shrink: 0;
}
.yp-vision-loop-preview-box {
  width: 100%;
  height: 78px;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--yt-glass-border);
  background: var(--yt-input-bg);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.yp-vision-loop-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.yp-vision-loop-preview-empty {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--yt-text-secondary);
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.78;
}
.yp-vision-loop-middle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--yt-text-secondary);
  opacity: 0.75;
  flex-shrink: 0;
  min-width: 16px;
}
.yp-vision-loop-middle-arrow {
  font-size: 13px;
  font-weight: 600;
}
.yp-vision-loop-middle-duration {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--yt-text-primary);
  background: var(--yt-button-bg);
  border: 1px solid var(--yt-glass-border);
  border-radius: 999px;
  padding: 1px 6px;
}

/* Classic Mode Loop Dropdown */
#yp-classic-loop-dropdown {
  position: fixed;
  z-index: 2200;
  min-width: 215px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--yt-glass-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-primary);
  backdrop-filter: var(--yt-glass-blur);
  -webkit-backdrop-filter: var(--yt-glass-blur);
  box-shadow: var(--yt-glass-shadow);
  border-radius: 12px;
  padding: 6px;
  transform: translateX(-50%) translateY(6px);
  opacity: 0;
  pointer-events: none;
  transition: opacity .18s ease, transform .18s cubic-bezier(.22,1,.36,1);
  font-family: Roboto, Arial, sans-serif;
  user-select: none;
}
#yp-classic-loop-dropdown.visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.yp-classic-loop-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--yt-text-primary);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.yp-classic-loop-item:hover {
  background: var(--yt-hover-bg);
}
.yp-classic-loop-item-left {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.yp-classic-loop-item-left svg {
  flex-shrink: 0;
  opacity: .85;
}
.yp-classic-loop-toggle-item {
  font-weight: 600;
}
.yp-classic-loop-toggle-item.is-active {
  color: var(--yt-accent);
}
.yp-classic-loop-status-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--yt-button-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-secondary);
}
.yp-classic-loop-toggle-item.is-active .yp-classic-loop-status-badge {
  background: rgba(255, 0, 51, 0.14);
  border-color: rgba(255, 0, 51, 0.35);
  color: var(--yt-accent);
}
.yp-classic-loop-point-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 700;
  background: var(--yt-button-bg);
  border: 1px solid var(--yt-glass-border);
  color: var(--yt-text-secondary);
  flex-shrink: 0;
}
.yp-classic-loop-item.has-point .yp-classic-loop-point-badge {
  background: var(--yt-accent);
  border-color: var(--yt-accent);
  color: #fff;
}
.yp-classic-loop-time-badge {
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--yt-text-secondary);
  background: var(--yt-input-bg);
  border: 1px solid var(--yt-glass-border);
  padding: 1px 7px;
  border-radius: 6px;
}
.yp-classic-loop-item.has-point .yp-classic-loop-time-badge {
  color: var(--yt-text-primary);
}
.yp-classic-loop-divider {
  height: 1px;
  background: var(--yt-glass-border);
  margin: 2px 4px;
}
.yp-classic-reset-item {
  color: var(--yt-text-secondary);
  font-size: 12px;
}
.yp-classic-reset-item:hover {
  color: var(--yt-accent);
}
.yp-classic-reset-item.is-disabled {
  opacity: .45;
}
`,
    'yp-shared-ui-styles': `html[data-yp-variant="classic"] .yp-download-modal-shell{
  gap:0;
  border-radius:14px;
  border:none;
  box-shadow:none;
  backdrop-filter:none;
  -webkit-backdrop-filter:none;
  padding:0;
  background:transparent;
}
html[data-yp-variant="classic"] .yp-download-modal-box{
  width:480px;
  background:var(--yt-glass-bg);
  border:1px solid var(--yt-glass-border);
  border-radius:14px;
  box-shadow:var(--yt-glass-shadow);
  backdrop-filter:var(--yt-glass-blur);
  -webkit-backdrop-filter:var(--yt-glass-blur);
  padding:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
html[data-yp-variant="classic"] .yp-download-modal-tabs{
  display:flex;
  background:var(--yt-panel-bg);
  border:none;
  border-bottom:1px solid var(--yt-glass-border);
  border-radius:0;
  padding:0;
  gap:0;
}
html[data-yp-variant="classic"] .yp-download-modal-tab{
  flex:1;
  padding:12px 16px;
  border:none;
  border-bottom:2px solid transparent;
  border-radius:0;
  background:transparent;
  color:var(--yt-text-secondary);
}
html[data-yp-variant="classic"] .yp-download-modal-tab:hover{
  color:var(--yt-text-primary);
  background:var(--yt-hover-bg);
}
html[data-yp-variant="classic"] .yp-download-modal-tab.active{
  background:transparent;
  color:#ff0033;
  border-bottom-color:#ff0033;
  box-shadow:none;
}
html[data-yp-variant="classic"] .yp-download-modal-content{
  padding:20px 22px 14px 22px;
}
html[data-yp-variant="classic"] .yp-download-quality{
  justify-content:center;
  gap:8px;
  padding:6px 0;
}
html[data-yp-variant="classic"] .yp-download-quality-label{
  justify-content:center;
}
html[data-yp-variant="classic"] .yp-download-pill{
  padding:7px 14px;
  border-radius:8px;
  background:var(--yt-input-bg);
  border:1px solid var(--yt-glass-border);
  color:var(--yt-text-primary);
  font-weight:500;
}
html[data-yp-variant="classic"] .yp-download-pill.active{
  background:rgba(255,0,51,0.12);
  color:#ff0033;
  border-color:#ff0033;
  box-shadow:none;
  font-weight:600;
}
html[data-yp-variant="classic"] .yp-download-source-wrap{
  display:none !important;
}
html[data-yp-variant="classic"] .yp-download-form-row{
  display:flex !important;
  align-items:center !important;
  justify-content:space-between !important;
  padding:12px 18px !important;
  background:var(--yt-panel-bg) !important;
  border-top:1px solid var(--yt-glass-border) !important;
  margin-top:6px !important;
}
html[data-yp-variant="classic"] .yp-download-classic-source-select{
  display:block !important;
  appearance:none !important;
  -webkit-appearance:none !important;
  background:var(--yt-input-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E") no-repeat right 10px center !important;
  border:1px solid var(--yt-glass-border) !important;
  border-radius:8px !important;
  color:var(--yt-text-primary) !important;
  font-size:12.5px !important;
  font-weight:600 !important;
  height:36px !important;
  padding:0 28px 0 12px !important;
  cursor:pointer !important;
  outline:none !important;
  transition:border-color var(--yp-dur-2) var(--yp-ease) !important;
}
html[data-yp-variant="classic"] .yp-download-classic-source-select:hover{
  border-color:var(--yp-accent) !important;
}
html[data-yp-variant="classic"] .yp-download-classic-source-select option{
  background:var(--yt-panel-bg) !important;
  color:var(--yt-text-primary) !important;
}
html[data-yp-variant="classic"] .yp-download-actions-wrap{
  display:flex !important;
  gap:10px !important;
  align-items:center !important;
  flex:initial !important;
}
html[data-yp-variant="classic"] .yp-download-btn{
  height:36px;
  padding:0 18px;
  flex:unset;
  border-radius:8px;
  font-size:13px;
}
html[data-yp-variant="classic"] .yp-download-btn.primary{
  background:#ff0033;
  border-color:#ff0033;
  color:#ffffff;
  box-shadow:none;
}
.glass-panel{background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);box-shadow:var(--yt-glass-shadow);}
.glass-card{background:var(--yt-panel-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-md);box-shadow:var(--yt-shadow);}
.stats-value, .yp-dislike-text, .speed-control-btn, .yp-voting-comments-icon{font-variant-numeric:tabular-nums;}
.glass-modal{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);display:flex;align-items:center;justify-content:center;z-index:99999;}
.glass-button{background:var(--yt-button-bg);border:1px solid var(--yt-glass-border);border-radius:var(--yt-radius-md);padding:var(--yt-space-sm) var(--yt-space-md);color:var(--yt-text-primary);cursor:pointer;transition:background-color .2s ease,transform .1s cubic-bezier(0.2,0,0,1),box-shadow .2s ease,color .2s ease,border-color .2s ease;}
.glass-button:hover{background:var(--yt-hover-bg);transform:translateY(-1px);box-shadow:var(--yt-shadow);}
.glass-button:active{transform:scale(0.96) !important;}
.glass-button.danger{background:var(--yt-danger-soft);border-color:var(--yt-danger-border);color:var(--yt-danger-text);}
.glass-button.danger:hover{background:var(--yt-danger-soft-hover);}
.download-site-controls{display:flex;flex-direction:column;gap:8px;margin-top:4px;}
.download-site-input{width:100%;height:36px;border-radius:10px;border:1px solid var(--yt-glass-border);background:var(--yt-input-bg, rgba(255,255,255,.06));color:var(--yt-text-primary);padding:10px 12px;box-sizing:border-box;}
.download-site-input.small{height:32px;font-size:12px;padding:6px 10px;}
.download-site-input:focus{background:var(--yt-hover-bg);outline:none;}
.download-site-cta{display:flex;gap:8px;width:100%;box-sizing:border-box;}
.download-site-cta.one-btn{justify-content:center;}
.download-site-cta .glass-button{flex:1;}
.download-site-cta.one-btn .glass-button{width:100%;}
.glass-dropdown{position:relative;display:inline-block;min-width:110px;box-sizing:border-box;}
.glass-dropdown--block,.yp-download-subtitle-dropdown,#report-type-dropdown,.yp-settings-item .glass-dropdown{display:block;width:100%;}
.glass-dropdown__toggle{display:flex;align-items:center;justify-content:space-between;gap:var(--yp-s-2);width:100%;min-height:36px;padding:var(--yp-s-2) var(--yp-s-3);border-radius:var(--yp-r-sm);background:var(--yp-fill-1);color:var(--yp-text-1);border:1px solid var(--yp-line-1);font-family:inherit;font-size:var(--yp-fs-sm);cursor:pointer;box-sizing:border-box;user-select:none;transition:background-color var(--yp-dur-2) var(--yp-ease),border-color var(--yp-dur-2) var(--yp-ease),color var(--yp-dur-2) var(--yp-ease);}
.glass-dropdown__toggle:hover{background:var(--yp-fill-2);border-color:var(--yp-line-2);}
.glass-dropdown__toggle:active{background:var(--yp-fill-3);}
.glass-dropdown__toggle:focus-visible{outline:2px solid var(--yp-accent);outline-offset:2px;}
.glass-dropdown__label{font-size:var(--yp-fs-sm);font-weight:400;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;flex:1;}
.glass-dropdown__chev{flex-shrink:0;color:var(--yp-text-2);opacity:0.85;transition:transform var(--yp-dur-2) var(--yp-ease);}
.glass-dropdown__toggle[aria-expanded="true"] .glass-dropdown__chev{transform:rotate(180deg);}
.glass-dropdown__list{position:absolute;left:0;right:0;bottom:calc(100% + var(--yp-s-2));top:auto;z-index:var(--yp-z-flyout);display:none;margin:0;padding:var(--yp-s-1);border-radius:var(--yp-r-md);list-style:none;background:var(--yp-mat-bg);border:1px solid var(--yp-mat-line);box-shadow:var(--yp-mat-shadow);backdrop-filter:var(--yp-mat-blur);-webkit-backdrop-filter:var(--yp-mat-blur);max-height:220px;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;scrollbar-width:thin;scrollbar-color:var(--yp-line-2) transparent;}
.glass-dropdown__list.glass-dropdown__list--down{bottom:auto;top:calc(100% + var(--yp-s-2));}
.glass-dropdown__list.is-open{display:block;}
html[data-yp-style="solid"] .glass-dropdown__list{background:var(--yp-mat-bg) !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}
.glass-dropdown__item{padding:var(--yp-s-2) var(--yp-s-3);border-radius:var(--yp-r-sm);margin:2px 0;cursor:pointer;color:var(--yp-text-1);font-size:var(--yp-fs-sm);font-weight:400;user-select:none;box-sizing:border-box;transition:background-color var(--yp-dur-2) var(--yp-ease),color var(--yp-dur-2) var(--yp-ease);}
.glass-dropdown__item:hover{background:var(--yp-fill-2);}
.glass-dropdown__item:active{background:var(--yp-fill-3);}
.glass-dropdown__item[aria-selected="true"]{background:var(--yp-accent-soft);color:var(--yp-accent);font-weight:500;}`,
    'yp-update-notification-styles': `.update-notification-card{z-index:10001;max-width:360px;background:var(--yt-glass-bg);padding:16px 18px;border-radius:var(--yt-radius-lg);color:var(--yt-text-primary);box-shadow:var(--yt-glass-shadow);border:1px solid var(--yt-glass-border);-webkit-backdrop-filter:var(--yt-glass-blur);backdrop-filter:var(--yt-glass-blur);animation:slideInFromBottom .4s ease-out}
.update-notification-layout{position:relative;display:flex;align-items:flex-start;gap:12px}
.update-notification-icon-wrap{background:var(--yt-glass-bg);border-radius:var(--yt-radius-xs);padding:10px;flex-shrink:0;border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur)}
.update-notification-content{flex:1;min-width:0}
.update-notification-title{font-weight:600;font-size:15px;margin-bottom:4px}
.update-notification-version{font-size:13px;opacity:.9;margin-bottom:8px}
.update-changelog-line{font-size:12px;opacity:.85;margin-bottom:6px}
.update-changelog-header{font-size:12px;font-weight:600;opacity:.95;margin-bottom:6px}
.update-changelog-box{font-size:12px;line-height:1.4;max-height:120px;overflow-y:auto;padding:8px;background:var(--yt-overlay-deep);border-radius:6px;border:1px solid var(--yt-surface-overlay-border);white-space:normal}
.update-changelog-fallback{font-size:12px;opacity:.85;margin-bottom:12px}
.update-notification-actions{display:flex;gap:8px}
.update-install-btn{background:var(--yt-accent);color:#fff;border:none;padding:8px 16px;border-radius:var(--yt-radius-xs);cursor:pointer;font-size:13px;font-weight:700;transition:transform .15s ease;box-shadow:0 6px 18px var(--yt-danger-ghost);backdrop-filter:var(--yt-glass-blur)}
.update-install-btn:active{transform:scale(0.96)!important}
.update-dismiss-btn{background:var(--yt-button-bg);color:var(--yt-text-primary);border:1px solid var(--yt-glass-border);padding:8px 12px;border-radius:var(--yt-radius-xs);cursor:pointer;font-size:13px;transition:background-color .12s ease,transform .12s ease,border-color .12s ease,color .12s ease}
.update-dismiss-btn:active{transform:scale(0.96)!important}
.update-close-btn{position:absolute;top:-8px;right:-8px;width:28px;height:28px;border-radius:50%;border:1px solid var(--yt-glass-border);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1;background:var(--yt-button-bg);color:var(--yt-text-primary);transition:background-color .18s ease,transform .18s ease}
.update-close-btn:active{transform:scale(0.96)!important}`,
    'yp-update-settings-styles': `.update-settings-card{padding:16px;margin-top:20px;border-radius:12px;background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);-webkit-backdrop-filter:var(--yt-glass-blur);backdrop-filter:var(--yt-glass-blur);box-shadow:var(--yt-glass-shadow)}
.update-settings-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.update-settings-title{margin:0;font-size:16px;font-weight:600;color:var(--yt-text-primary)}
.update-settings-status-card{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center;padding:16px;background:var(--yt-surface-overlay-subtle);border-radius:10px;margin-bottom:16px}
.update-settings-version-row{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.update-settings-label{font-size:14px;font-weight:600;color:var(--yt-text-primary)}
.update-settings-pill{font-size:13px;font-weight:600;color:var(--yt-text-primary);padding:3px 10px;background:var(--yt-surface-overlay-soft);border-radius:12px;border:1px solid var(--yt-glass-border)}
.update-settings-meta{font-size:12px;color:var(--yt-text-secondary)}
.update-settings-meta-strong{font-weight:500}
.update-settings-latest{color:var(--yt-update-available-text);font-weight:600}
.update-status-col{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.update-status-badge{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:20px}
.update-status-badge--available{background:linear-gradient(135deg,var(--yt-danger-soft),var(--yt-danger-border));border:1px solid var(--yt-danger-card-border)}
.update-status-badge--ok{background:linear-gradient(135deg,var(--yt-success-soft),var(--yt-success-soft-hover));border:1px solid var(--yt-success-accent-soft)}
.update-status-dot{width:6px;height:6px;border-radius:50%}
.update-status-dot--available{background:var(--yt-update-available-dot);animation:pulse 2s infinite}
.update-status-dot--ok{background:var(--yt-success-accent)}
.update-status-text{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.update-status-text--available{color:var(--yt-update-available-text)}
.update-status-text--ok{color:var(--yt-success-accent)}
.update-install-inline-btn{background:linear-gradient(135deg,var(--yt-update-install-bg-start),var(--yt-update-install-bg-end));color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:background-color .3s ease,transform .15s cubic-bezier(0.2,0,0,1),box-shadow .3s ease;box-shadow:0 4px 12px var(--yt-update-install-shadow)}
.update-install-inline-btn:active{transform:scale(0.96)!important}
.update-settings-actions{display:flex;gap:12px}
.update-check-btn{flex:1;padding:12px;font-size:13px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.update-refresh-icon{display:inline-block;vertical-align:middle;flex-shrink:0}`,
    'yp-video-stats-styles': `.videoStats{width:36px;height:36px;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-left:8px;margin-right:8px;background:none;transition:transform .18s ease,background .18s}
.videoStats:hover{transform:translateY(-2px)}.videoStats svg{width:18px;height:18px;fill:var(--yt-text-primary)}
.shortsStats{width:48px;height:48px;border-radius:999px;display:flex;align-items:center;justify-content:center;z-index:1;cursor:pointer;box-shadow:var(--yt-glass-shadow);background:var(--yt-glass-bg);border:1px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);margin:0 auto 10px;align-self:center;color:var(--yt-text-primary);padding:0;transition:background-color .3s cubic-bezier(0.2,0,0,1),color .3s cubic-bezier(0.2,0,0,1),border-color .3s cubic-bezier(0.2,0,0,1),transform .15s cubic-bezier(0.2,0,0,1),box-shadow .3s cubic-bezier(0.2,0,0,1)}
.shortsStats:hover{background:var(--yt-hover-bg)}.shortsStats:active{transform:scale(0.96)!important}.shortsStats svg{width:22px;height:22px;display:block;pointer-events:none}
.stats-menu-container{position:relative;display:inline-block}.stats-horizontal-menu{position:absolute;display:flex;left:100%;top:0;height:100%;visibility:hidden;opacity:0;transition:visibility 0s,opacity 0.2s linear;z-index:100}.stats-menu-container:hover .stats-horizontal-menu{visibility:visible;opacity:1}.stats-menu-button{margin-left:8px;white-space:nowrap}
button-view-model{display:inline-flex;align-items:center;justify-content:center}
button-view-model.yt-spec-button-view-model{vertical-align:top}
.channel-banner-overlay{position:absolute;top:0;left:0;width:100%;height:100%;border-radius:15px;z-index:10;display:flex;justify-content:space-around;align-items:center;color:white;font-family:var(--yt-stats-font-family,'Rubik',sans-serif);font-size:var(--yt-stats-font-size,24px);box-sizing:border-box;transition:background-color .3s ease;backdrop-filter:var(--yp-mat-thin-blur)}
.settings-button{position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;cursor:pointer;z-index:11;transition:transform 0.2s cubic-bezier(0.2,0,0,1), opacity 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;display:flex;align-items:center;justify-content:center;background:var(--yt-stats-channel-button-bg);backdrop-filter:var(--yp-mat-thin-blur);border:1px solid var(--yt-stats-channel-button-border);opacity:0.7}
.channel-banner-overlay:hover .settings-button{opacity:1}
.settings-button:hover{transform:rotate(30deg) scale(1.1);opacity:1;background:var(--yt-stats-channel-button-hover);border-color:var(--yt-stats-channel-button-hover-border)}
.settings-button:active{transform:rotate(30deg) scale(0.96) !important}
.settings-button svg{width:18px;height:18px;fill:var(--yt-text-primary);filter:drop-shadow(0 1px 2px var(--yt-stats-channel-filter-shadow))}
.settings-menu{position:absolute;top:52px;right:12px;background:var(--yt-glass-bg);padding:16px;border-radius:16px;z-index:12;display:flex;flex-direction:column;gap:12px;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);border:1px solid var(--yt-glass-border);box-shadow:var(--yt-glass-shadow);min-width:320px;opacity:0;visibility:hidden;transform:translateY(-10px) scale(0.98);transition:opacity 0.2s cubic-bezier(0.2,0,0.2,1), transform 0.2s cubic-bezier(0.2,0,0.2,1), visibility 0.2s cubic-bezier(0.2,0,0.2,1);pointer-events:none}
.settings-menu.show{opacity:1;visibility:visible;transform:translateY(0) scale(1);pointer-events:auto}
.settings-menu .yp-settings-item{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:var(--yt-stats-channel-menu-item-bg)}
.settings-menu .yp-settings-item + .yp-settings-item{margin-top:6px}
.settings-menu .yp-settings-item .yp-settings-item-label{color:var(--yt-stats-channel-label-text);font-size:14px;font-weight:500}
.settings-menu label{color:var(--yt-stats-channel-label-text)!important;font-size:14px!important;font-weight:500!important;margin-bottom:6px!important}
.settings-menu input[type="range"]{-webkit-appearance:none;width:100%!important;height:4px;background:var(--yt-stats-channel-range-bg)!important;border-radius:2px;margin:12px 0 4px 0!important;cursor:pointer}
.settings-menu input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;height:16px;width:16px;border-radius:50%;background:var(--yt-stats-channel-range-thumb);margin-top:-6px;box-shadow:0 2px 4px var(--yt-stats-channel-text-shadow);border:2px solid var(--yt-text-primary);transition:transform .1s;cursor:pointer}
.settings-menu input[type="range"]::-webkit-slider-thumb:hover{transform:scale(1.2)}
.settings-menu select{width:100%!important;background:var(--yt-stats-channel-input-bg)!important;border:1px solid var(--yt-stats-channel-input-bg)!important;color:var(--yt-text-primary)!important;padding:8px 12px!important;border-radius:6px!important;font-size:13px!important;margin-bottom:12px!important;cursor:pointer;outline:none}
.settings-menu select:hover{background:var(--yt-stats-channel-input-hover)!important}
.settings-menu select option{background:var(--yt-stats-channel-select-option-bg);color:var(--yt-text-primary)}
.settings-menu input[type="checkbox"]:not(.yp-settings-checkbox){appearance:none;width:18px!important;height:18px!important;border:2px solid var(--yt-stats-channel-checkbox-border)!important;border-radius:4px!important;background:transparent!important;cursor:pointer;position:relative;margin-right:12px!important;vertical-align:middle;transition:background-color .2s ease, border-color .2s ease, transform .1s cubic-bezier(0.2,0,0,1)}
.settings-menu input[type="checkbox"]:not(.yp-settings-checkbox):active{transform:scale(0.96) !important}
.settings-menu input[type="checkbox"]:not(.yp-settings-checkbox):checked{background:var(--yt-stats-channel-range-thumb)!important;border-color:var(--yt-stats-channel-range-thumb)!important}
.settings-menu input[type="checkbox"]:not(.yp-settings-checkbox):checked::after{content:'';position:absolute;left:5px;top:1px;width:4px;height:10px;border:solid var(--yt-text-primary);border-width:0 2px 2px 0;transform:rotate(45deg)}
.stat-container{display:flex;flex-direction:column;align-items:center;justify-content:center;visibility:hidden;width:33%;height:100%;padding:0 1rem;text-shadow:0 2px 4px var(--yt-stats-channel-text-shadow)}
.number-container{display:flex;align-items:center;justify-content:center;font-weight:700;min-height:3rem;font-variant-numeric:tabular-nums}
.label-container{display:flex;align-items:center;margin-top:.5rem;font-size:1.2rem;opacity:.9}
.label-container svg{width:1.5rem;height:1.5rem;margin-right:.5rem;filter:drop-shadow(0 1px 2px var(--yt-stats-channel-text-shadow))}
.difference{font-size:1.8rem;height:2rem;margin-bottom:.5rem;transition:opacity .3s;font-variant-numeric:tabular-nums}
.spinner-container{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center}
.spinner-container .stats-spinner{width:60px;height:60px;animation:spin 1s linear infinite}
.spinner-container .stats-spinner circle{stroke-dasharray:80;stroke-dashoffset:60;animation:dash 1.5s ease-in-out infinite}
@media(max-width:768px){.channel-banner-overlay{flex-direction:column;padding:8px;min-height:160px}.settings-menu{width:280px!important;right:4px!important;top:48px!important}}
.setting-group{margin-bottom:12px}
.setting-group:last-child{margin-bottom:0}
.setting-value{color:var(--yt-stats-channel-text-value);font-size:12px;margin-top:4px;font-variant-numeric:tabular-nums}
.country-flag,.channel-banner-overlay{outline:1px solid var(--yt-glass-border);outline-offset:-1px}
.country-flag{border-radius:4px}
.stats-result-url{margin-top:8px;font-size:12px;opacity:.8;word-break:break-all}
.stats-card--compact{padding:10px}
.stats-card--compact .stats-label{font-size:12px}
.stats-card--compact .stats-value{font-size:16px}
.stats-thumb-extras--wrap{flex-wrap:wrap;gap:8px;margin-top:12px}
.channel-stat-digit{display:inline-block;width:.6em;text-align:center;margin:0 .025em}
.channel-stat-comma{display:inline-block;width:.3em;text-align:center}
.channel-stat-number-row{display:flex;justify-content:center;align-items:center;letter-spacing:.025em}
.channel-stat{display:flex;flex-direction:column;align-items:center;justify-content:center;width:33%;height:100%;padding:0 1rem}
.channel-stat--hidden{visibility:hidden}
.channel-stat-number-col{display:flex;flex-direction:column;align-items:center;justify-content:center}
.channel-stat-difference{font-size:2.5rem;height:2.5rem;margin-bottom:1rem}
.channel-stat-number{font-weight:700;line-height:1;height:4rem;letter-spacing:.025em;font-size:var(--yt-stats-font-size,24px);font-family:var(--yt-stats-font-family,'Rubik',sans-serif)}
.channel-stat-label-row{display:flex;align-items:center;margin-top:.5rem}
.channel-stat-icon{width:2rem;height:2rem;margin-right:.75rem}
.channel-stat-label{font-size:2rem}`,
    'yp-video-stats-modal-styles': `.stats-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--yt-modal-bg);z-index:var(--yt-z-modal);display:flex;align-items:center;justify-content:center;animation:fadeInModal .18s;backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur)}
.stats-modal-container{max-width:1100px;max-height:calc(100vh - 32px);display:flex;flex-direction:column}
.stats-modal-content{position:relative;background:var(--yt-glass-bg);border-radius:var(--yt-radius-lg);box-shadow:var(--yt-glass-shadow);overflow:visible;display:flex;flex-direction:column;animation:scaleInModal .18s;border:1.5px solid var(--yt-glass-border);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur)}
.stats-modal-body{position:relative;padding:24px 16px 16px;overflow:visible;flex:1;display:flex;flex-direction:column}
.stats-thumb-title-centered{position:absolute;top:-44px;left:50%;transform:translateX(-50%);z-index:3;display:block;width:fit-content;max-width:min(90%,760px);margin:0;padding:8px 16px;border-radius:18px;border:1px solid var(--yt-glass-border);background:var(--yt-glass-bg);font-size:14px;font-weight:500;color:var(--yt-text-primary);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:default;transition:transform .25s cubic-bezier(.4,0,.2,1),background-color .25s cubic-bezier(.4,0,.2,1),border-color .25s cubic-bezier(.4,0,.2,1),color .25s cubic-bezier(.4,0,.2,1)}
.stats-thumb-row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.stats-thumb-img{width:36vw;max-width:420px;height:auto;object-fit:cover;border-radius:8px;flex-shrink:0;outline:1px solid var(--yt-glass-border);outline-offset:-1px;max-height:44vh;border:none}
.stats-thumb-row .stats-grid{flex:1;min-width:0}
.stats-side-column{flex:1;min-width:280px;display:flex;flex-direction:column}
.stats-thumb-left{display:flex;flex-direction:column;align-items:center;gap:8px}
.stats-thumb-left .stats-thumb-sub{font-size:13px;color:var(--yt-text-secondary)}
.stats-thumb-extras{display:flex;flex-direction:row;gap:10px;align-items:center;margin-top:8px}
.stats-thumb-extras .stats-card{padding:8px 10px}
.stats-thumb-meta{display:flex;flex-direction:column;justify-content:center}
.stats-thumb-sub{font-size:13px;color:var(--yt-text-secondary)}
.stats-loader{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--yt-text-secondary)}
.stats-spinner{width:60px;height:60px;animation:spin 1s linear infinite;margin-bottom:16px}
.stats-spinner circle{stroke-dasharray:80;stroke-dashoffset:60;animation:dash 1.5s ease-in-out infinite}
.stats-error{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--yt-stats-error);text-align:center}
.stats-error-icon{width:60px;height:60px;margin-bottom:16px;stroke:var(--yt-stats-error)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.stats-card{background:var(--yt-surface-overlay-subtle);border-radius:12px;padding:12px;display:flex;align-items:center;gap:12px;border:1px solid var(--yt-glass-border);transition:transform .18s ease,box-shadow .18s ease}
.stats-card:hover{transform:translateY(-2px);box-shadow:0 8px 20px var(--yt-stats-shadow-hover)}
.stats-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.stats-icon svg{width:24px;height:24px}
.stats-icon-views{background:var(--yt-stats-icon-views-bg);color:var(--yt-stats-icon-views)}
.stats-icon-likes{background:var(--yt-stats-icon-likes-bg);color:var(--yt-stats-icon-likes)}
.stats-icon-dislikes{background:var(--yt-stats-icon-dislikes-bg);color:var(--yt-stats-icon-dislikes)}
.stats-icon-comments{background:var(--yt-stats-icon-comments-bg);color:var(--yt-stats-icon-comments)}
.stats-icon-viewers{background:var(--yt-stats-icon-viewers-bg);color:var(--yt-stats-icon-viewers)}
.stats-icon-subscribers{background:var(--yt-stats-icon-subscribers-bg);color:var(--yt-stats-icon-subscribers)}
.stats-icon-videos{background:var(--yt-stats-icon-videos-bg);color:var(--yt-stats-icon-videos)}
.stats-card-pair{display:flex;gap:8px;align-items:stretch}
.stats-card-pair .stats-card{flex:1;margin:0}
@media(max-width:480px){.stats-card-pair{flex-direction:column}}
.stats-info{flex:1;min-width:0}
.stats-label{font-size:13px;color:var(--yt-text-secondary);margin-bottom:4px;font-weight:500}
.stats-value{font-size:20px;font-weight:700;color:var(--yt-text-primary);line-height:1.2;margin-bottom:2px;font-variant-numeric:tabular-nums}
.stats-exact{font-size:13px;color:var(--yt-text-secondary);font-weight:400;font-variant-numeric:tabular-nums}
@media(max-width:768px){.stats-modal-container{width:95vw}.stats-grid{grid-template-columns:1fr}.stats-card{padding:16px}.stats-side-column{min-width:0;width:100%}}
.stats-author-big{display:block;text-align:center;margin-top:13px;padding-inline:8px}
.stats-author-name-big{display:block;color:var(--yt-text-primary);font-weight:600;font-size:16px}
.stats-author-handle-big{display:inline-block;color:var(--yt-text-secondary);font-weight:700;font-size:20px;text-decoration:none;padding:6px 10px;border-radius:6px}
.stats-author-handle-big:hover{color:var(--yt-stats-link-hover);text-decoration:underline}
html:not([dark]) .stats-author-handle-big{color:var(--yt-stats-link-color)}
html:not([dark]) .stats-author-handle-big:hover{color:var(--yt-stats-link-hover-dark)}

/* Vision mode (default): Classic header hidden */
.stats-classic-header{display:none !important;}

/* Classic mode (Concept B: Monolithic Studio Window) */
html[data-yp-variant="classic"] .stats-modal-container{max-width:min(860px,92vw);}
html[data-yp-variant="classic"] .stats-modal-content{background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:14px;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);padding:0;overflow:hidden;display:flex;flex-direction:column;align-items:stretch;}
html[data-yp-variant="classic"] .stats-classic-header{display:flex !important;align-items:center;justify-content:space-between;padding:12px 18px;background:var(--yt-panel-bg);border-bottom:1px solid var(--yt-glass-border);box-sizing:border-box;}
html[data-yp-variant="classic"] .stats-classic-title-group{display:flex;align-items:center;gap:10px;min-width:0;flex:1;}
html[data-yp-variant="classic"] .stats-classic-icon{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:8px;background:var(--yt-hover-bg);color:var(--yt-accent,#ff0033);}
html[data-yp-variant="classic"] .stats-classic-title{font-size:15px;font-weight:600;color:var(--yt-text-primary);}
html[data-yp-variant="classic"] .stats-classic-channel-badge{display:none;background:var(--yt-hover-bg);border:1px solid var(--yt-glass-border);color:var(--yt-text-secondary);font-size:12px;font-weight:500;padding:2px 8px;border-radius:12px;}
html[data-yp-variant="classic"] .stats-classic-close-btn{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:transparent;border:none;color:var(--yt-text-secondary);cursor:pointer;transition:background-color .15s,color .15s;}
html[data-yp-variant="classic"] .stats-classic-close-btn:hover{background:var(--yt-hover-bg);color:var(--yt-text-primary);}
html[data-yp-variant="classic"] .stats-modal-body{padding:16px 18px 20px;gap:16px;}
html[data-yp-variant="classic"] .stats-thumb-title-centered{display:none !important;}
html[data-yp-variant="classic"] .stats-thumb-row{display:flex;flex-direction:column-reverse;gap:14px;}
html[data-yp-variant="classic"] .stats-side-column{width:100%;flex:none;}
html[data-yp-variant="classic"] .stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;width:100%;}
html[data-yp-variant="classic"] .stats-card-pair{display:contents;}
html[data-yp-variant="classic"] .stats-card{padding:10px 12px;}
html[data-yp-variant="classic"] .stats-thumb-left{display:flex;flex-direction:row;align-items:stretch;gap:14px;width:100%;}
html[data-yp-variant="classic"] .stats-thumb-img{width:48%;max-width:48%;height:auto;border-radius:10px;object-fit:cover;}
html[data-yp-variant="classic"] .stats-thumb-extras{flex:1;display:flex;flex-direction:column;gap:8px;margin-top:0 !important;justify-content:center;}
html[data-yp-variant="classic"] .stats-thumb-extras .stats-card{width:100%;box-sizing:border-box;}
html[data-yp-variant="classic"] .stats-author-big{display:none;}`,
    'yp-zoom-styles': `
      /* Compact control bar matching YouTube control style */
#yp-zoom-control{position: absolute; left: 12px; bottom: 70px; z-index: 2200; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 24px; background: var(--yt-glass-bg); border: 1px solid var(--yt-glass-border); color: var(--yt-text-primary); font-size: 12px; box-shadow: var(--yt-glass-shadow); backdrop-filter: var(--yt-glass-blur); -webkit-backdrop-filter: var(--yt-glass-blur); opacity: 0; pointer-events: none;}
#yp-zoom-control input[type=range]{width: 120px; -webkit-appearance: none; background: transparent; height: 24px;}
/* WebKit track */
#yp-zoom-control input[type=range]::-webkit-slider-runnable-track{height: 4px; background: var(--yt-button-bg); border-radius: 3px;}
#yp-zoom-control input[type=range]::-webkit-slider-thumb{-webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--yt-text-primary); box-shadow: 0 0 0 6px var(--yt-button-bg); margin-top: -4px;}
/* Firefox */
#yp-zoom-control input[type=range]::-moz-range-track{height: 4px; background: var(--yt-button-bg); border-radius: 3px;}
#yp-zoom-control input[type=range]::-moz-range-thumb{width: 12px; height: 12px; border-radius: 50%; background: var(--yt-text-primary); border: none;}
#yp-zoom-control .zoom-label{min-width:36px;text-align:center;font-size:11px;padding:0 6px;user-select:none}
#yp-zoom-control::after{content:'Shift + Wheel to zoom';position:absolute;bottom:100%;right:0;padding:4px 8px;background:var(--yt-notification-bg);color:var(--yt-text-primary);font-size:10px;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .2s,transform .2s}
#yp-zoom-control:hover::after{opacity:1;transform:translateY(-4px)}
#yp-zoom-control .zoom-reset{background: var(--yt-button-bg); border: none; color: inherit; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer; width: 28px; height: 28px;}
#yp-zoom-control .zoom-reset:hover{background: var(--yt-hover-bg)}
#yp-zoom-control .zoom-reset svg{display:block;width:14px;height:14px}
/* Hidden state to mirror YouTube controls autohide */
#yp-zoom-control.ytp-hidden,
.ytp-autohide #yp-zoom-control,
.ytp-hide-controls #yp-zoom-control{opacity:0 !important;transform:translateY(6px) !important;pointer-events:none !important}
#yp-zoom-control{transition:opacity .18s ease, transform .18s ease}
    `,
    'comment-delete-styles': `
        .comment-checkbox-anchor{position:relative;display:inline-flex;align-items:center;gap:8px;width:auto;}
        .comment-checkbox-floating{position:absolute;top:-4px;right:-32px;margin:0;}
        /* Panel styled to match shorts feedback: glassmorphism, rounded corners, soft shadow */
        .comment-controls-panel{position:fixed;top:50%;right:24px;transform:translateY(-50%);display:flex;flex-direction:column;gap:14px;z-index:10000;padding:16px 18px;background:var(--yt-glass-bg);border:1.5px solid var(--yt-glass-border);border-radius:20px;box-shadow:var(--yt-glass-shadow);backdrop-filter:var(--yt-glass-blur);-webkit-backdrop-filter:var(--yt-glass-blur);min-width:220px;max-width:300px;color:var(--yt-text-primary);transition:transform .22s cubic-bezier(.4,0,.2,1),opacity .22s,box-shadow .2s}
        .comment-controls-header{display:flex;align-items:center;justify-content:space-between;gap:12px;}
        .comment-controls-panel.is-collapsed{padding:14px 18px;}
        .comment-controls-panel.is-collapsed .comment-controls-title{font-weight:500;opacity:.85;}
        .comment-controls-panel.is-collapsed .comment-controls-close{transform:rotate(45deg);}
        .comment-controls-panel.is-collapsed .comment-controls-actions{display:none!important;}
        .comment-controls-title{font-size:15px;font-weight:600;letter-spacing:.3px;}
        .comment-controls-close{background:transparent;border:none;cursor:pointer;padding:6px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:var(--yt-text-primary);transition:transform .2s cubic-bezier(0.2,0,0,1),color .2s cubic-bezier(0.2,0,0,1);}
        .comment-controls-close:hover{transform:rotate(90deg) scale(1.05);color:var(--yt-accent);}
        .comment-controls-close:active{transform:rotate(90deg) scale(0.96) !important;}
        .comment-controls-actions{display:flex;flex-direction:column;gap:10px;}
        .comment-controls-actions.is-hidden{display:none!important;}
        .comment-controls-button{padding:12px 16px;border-radius:var(--yt-radius-md);border:1px solid var(--yt-glass-border);cursor:pointer;font-size:13px;font-weight:500;background:var(--yt-button-bg);color:var(--yt-text-primary);transition:background-color .2s cubic-bezier(0.2,0,0,1),border-color .2s cubic-bezier(0.2,0,0,1),color .2s cubic-bezier(0.2,0,0,1),transform .1s cubic-bezier(0.2,0,0,1),box-shadow .2s cubic-bezier(0.2,0,0,1);text-align:center;}
        .comment-controls-button:disabled{opacity:.5;cursor:not-allowed;}
        .comment-controls-button:not(:disabled):hover{transform:translateY(-1px);box-shadow:var(--yt-shadow);}
        .comment-controls-button:not(:disabled):active{transform:scale(0.96) !important;}
        .comment-controls-button--danger{background:var(--yt-danger-soft);border-color:var(--yt-danger-border);color:var(--yt-danger-text);}
        .comment-controls-button--primary{background:var(--yt-primary-soft);border-color:var(--yt-primary-border);color:var(--yt-primary-text);}
        .comment-controls-button--success{background:var(--yt-success-soft);border-color:var(--yt-success);color:var(--yt-success);}
        .comment-controls-button--danger:not(:disabled):hover{background:var(--yt-danger-soft-hover);}
        .comment-controls-button--primary:not(:disabled):hover{background:var(--yt-primary-soft-hover);}
        .comment-controls-button--success:not(:disabled):hover{background:var(--yt-success-soft-hover);}
         @media(max-width:1280px){
          .comment-controls-panel{top:auto;bottom:24px;transform:none;right:16px;}
        }
        @media(max-width:768px){
          .comment-controls-panel{position:fixed;left:16px;right:16px;bottom:16px;top:auto;transform:none;max-width:none;}
          .comment-controls-actions{flex-direction:row;flex-wrap:wrap;}
          .comment-controls-button{flex:1;min-width:140px;}
        }
      `,
    'yp-comment-translate-styles': `
        .yp-comment-translate-btn{
          display:inline-flex;align-items:center;gap:4px;
          background:none;border:none;cursor:pointer;
          color:var(--yt-text-secondary);
          font-size:1.2rem;line-height:1.8rem;font-weight:400;
          padding:4px 0;margin-top:4px;
          font-family:'Roboto','Arial',sans-serif;
          transition:color .2s;
        }
        .yp-comment-translate-btn:hover{color:var(--yt-text-primary);}
        .yp-comment-translate-btn:active{transform:scale(0.96) !important;}
        .yp-comment-translate-btn[disabled]{opacity:.5;cursor:wait;}
        .yp-comment-translate-btn svg{flex-shrink:0;}
      `,
    'yp-music-enhanced-styles': `
        /* Remove borders and shadows from nav/guide when bauhaus sidenav is enabled */
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #nav-bar-background.ytmusic-app-layout { border-bottom: none !important; box-shadow: none !important; }
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #nav-bar-divider.ytmusic-app-layout { border-top: none !important; }
        ytmusic-app-layout[is-bauhaus-sidenav-enabled] #mini-guide-background.ytmusic-app-layout { border-right: 0 !important; }
        ytmusic-nav-bar, ytmusic-app-layout[is-bauhaus-sidenav-enabled] .ytmusic-nav-bar { border: none !important; box-shadow: none !important; }
        /* Center the settings button in the top nav bar (fixes it being rendered at the bottom) */
        ytmusic-settings-button.style-scope.ytmusic-nav-bar, ytmusic-nav-bar ytmusic-settings-button.style-scope.ytmusic-nav-bar {position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; bottom: auto !important; margin: 0 !important; z-index: 1000 !important;}
        /* Center the search box in the top nav bar */
        ytmusic-search-box, ytmusic-nav-bar ytmusic-search-box, ytmusic-searchbox, ytmusic-nav-bar ytmusic-searchbox {position: absolute !important; left: 50% !important; top: 50% !important; transform: translate(-50%, -50%) !important; margin: 0 !important; max-width: 75% !important; width: auto !important; z-index: 900 !important;}
    `,
    'yp-music-immersive-search-styles': `
        /* yt-Immersive search behaviour for YouTube Music: expand/center the search when focused */
        ytmusic-search-box:has(input:focus), ytmusic-searchbox:has(input:focus), ytmusic-search-box:focus-within, ytmusic-searchbox:focus-within {position: fixed !important; left: 50% !important; top: 12vh !important; transform: translateX(-50%) !important; height: auto !important; max-width: 900px !important; width: min(90vw, 900px) !important; z-index: 1200 !important; display: block !important;}
        @media only screen and (min-width: 1400px) {ytmusic-search-box:has(input:focus), ytmusic-searchbox:has(input:focus) {top: 10vh !important; max-width: 1000px !important; transform: translateX(-50%) scale(1.05) !important;}}
        /* Highlight the input and add a soft glow */
        ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input, ytmusic-search-box:focus-within input, ytmusic-searchbox:focus-within input {background-color: var(--yt-bg-primary) !important; box-shadow: black 0 0 30px !important;}
        @media (prefers-color-scheme: dark) {ytmusic-search-box:has(input:focus) input, ytmusic-searchbox:has(input:focus) input {background-color: var(--yt-modal-bg) !important;}}
        /* Dim and scale the main content while immersive search is active */
        ytmusic-app-layout:has(ytmusic-search-box:has(input:focus)) #main-panel, ytmusic-app-layout:has(ytmusic-searchbox:has(input:focus)) #main-panel {opacity: .3 !important; transform: scale(1.03) !important;}
    `,
    'yp-music-hover-styles': `
        .ytmusic-guide-renderer {opacity: 0.01 !important; transition: opacity 0.5s ease-in-out !important;}
        .ytmusic-guide-renderer:hover { opacity: 1 !important;}
        ytmusic-app[is-bauhaus-sidenav-enabled] #guide-wrapper.ytmusic-app {background-color: transparent !important; border: none !important;}
    `,
    'yp-music-player-sidebar-styles': `
        #side-panel {width: 40em !important; height: 80vh !important; padding: 0 2em !important; right: -30em !important; top: 10vh !important; opacity: 0 !important; position: absolute !important; transition: right 0.3s ease-in-out, opacity 0.3s ease-in-out !important; backdrop-filter: var(--yp-mat-blur)!important; background-color: var(--yt-panel-overlay-subtle) !important; border-radius: 1em !important; box-shadow: var(--yt-shadow-deep-1) 0px -36px 30px inset, var(--yt-shadow-deep-2) 0px -79px 40px inset, var(--yt-shadow-deep-3) 0px 2px 1px, var(--yt-shadow-deep-4) 0px 4px 2px, var(--yt-shadow-deep-4) 0px 8px 4px, var(--yt-shadow-deep-4) 0px 16px 8px, var(--yt-shadow-deep-4) 0px 32px 16px !important;}
        #side-panel tp-yt-paper-tabs {transition: height 0.3s ease-in-out !important; height: 0 !important;}
        #side-panel:hover {right: 0 !important; opacity: 1 !important;}
        #side-panel:hover tp-yt-paper-tabs {height: 4em !important;}
        #side-panel:has(ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]):not(:has(ytmusic-message-renderer:not([style="display: none;"]))) {right: 0 !important; opacity: 1 !important;}
        #side-panel {min-width: auto !important;}
    `,
    'yp-music-centered-player-styles': `
        ytmusic-app-layout:not([player-ui-state="FULLSCREEN"]) #main-panel {position: absolute !important; height: 70vh !important; max-width: 70vw !important; aspect-ratio: 1 !important; top: 50vh !important; left: 50vw !important; transform: translate(-50%, -50%) !important;}
        #player-page {padding: 0 !important; margin: 0 !important; left: 0 !important; top: 0 !important; height: 100% !important; width: 100% !important;}
    `,
    'yp-music-player-bar-styles': `
        ytmusic-player-bar, #player-bar-background {margin: 1vw !important; width: 98vw !important; border-radius: 1em !important; overflow: hidden !important; transition: background-color 0.5s ease-in-out, transform 0.5s ease-in-out, opacity 0.5s ease-in-out, margin 0.5s ease-in-out, width 0.5s ease-in-out, height 0.5s ease-in-out, box-shadow 0.5s ease-in-out !important; background-color: var(--yt-panel-overlay-weak) !important; box-shadow: var(--yt-shadow-deep-1) 0px -36px 30px inset, var(--yt-shadow-deep-2) 0px -79px 40px inset, var(--yt-shadow-deep-3) 0px 2px 1px, var(--yt-shadow-deep-4) 0px 4px 2px, var(--yt-shadow-deep-4) 0px 8px 4px, var(--yt-shadow-deep-4) 0px 16px 8px, var(--yt-shadow-deep-4) 0px 32px 16px !important;}
        #layout:not([player-ui-state="PLAYER_PAGE_OPEN"]) #player-bar-background {background-color: var(--yt-panel-overlay-subtle) !important;}
    `,
    'yp-music-centered-player-bar-styles': `
        #left-controls {position: absolute !important; left: 49vw !important; bottom: 15px !important; transform: translateX(-50%) !important; width: fit-content !important; order: 1 !important;}
        .time-info {position: absolute !important; bottom: -10px !important; left: 0 !important; width: 100% !important; text-align: center !important; padding: 0 !important; margin: 0 !important;}
        .middle-controls {position: absolute !important; left: 1vw !important; bottom: 15px !important; max-width: 30vw !important; order: 0 !important;}
    `,
    'yp-music-mini-player-styles': `
        #main-panel:has(ytmusic-player[player-ui-state="MINIPLAYER"]) {position: fixed !important; width: 100vw !important; height: 100vh !important; top: -100vh !important; left: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; max-width: 100vw !important;}
        ytmusic-player[player-ui-state="MINIPLAYER"] {position: fixed !important; bottom: calc(100vh + 120px) !important; right: 30px !important; width: 350px !important; height: fit-content !important;}
        #av-id:has(ytmusic-av-toggle) {position: absolute !important; left: 50% !important; transform: translateX(-50%) !important; top: -4em !important; opacity: 0 !important; transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out !important;}
        #av-id:has(ytmusic-av-toggle):hover {opacity: 1 !important;}
        #player[player-ui-state="MINIPLAYER"] {display: none !important;}
      /* Chrome-specific robustness: ensure the AV toggle container is above overlays
         and can receive hover even if :has() behaves differently. Also provide a
         non-:has fallback so the element is hoverable regardless of child matching. */
      /* Use absolute positioning (keeps internal menu alignment) but promote
         stacking and rendering to ensure it sits above overlays and receives clicks. */
        #av-id {position: absolute !important; left: 50% !important; transform: translateX(-50%) translateZ(0) !important; top: -4em !important; z-index: 10000 !important; pointer-events: auto !important; display: block !important; visibility: visible !important; width: auto !important; height: auto !important; will-change: transform, opacity !important;}
        #av-id ytmusic-av-toggle {pointer-events: auto !important;}
        #av-id:hover {opacity: 1 !important;}
      /* Prevent overlapping overlays from stealing clicks when hovering the toggle.
         This is a conservative rule; if a specific overlay still steals clicks we
         can target it explicitly later. */
        #av-id:hover, #av-id:active { filter: none !important; }
    `,
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
  // `yp-enhanced-styles` because those are
  // still owned by their feature flags and runtime init paths.
  const BOOTSTRAP_STYLE_BUNDLE_IDS = [
    'yp-screenshot-styles',
    'shorts-download-styles',
    'pip-styles',
    'thumbnail-viewer-styles',
    'yp-comments-modal-style',
    'yp-download-styles',
    'yp-stats-styles',
    'yp-music-fab-styles',
  ];

  /**
   * Bootstrap all presentation-safe static CSS bundles into the StyleManager.
   * Called on init, DOMContentLoaded, and SPA navigation events.
   */
  const bootstrapStaticStyles = () => {
    // Only the comment panel is needed on myactivity; the static style bundles
    // belong to the YouTube surface.
    if (window.YouTubePlusHostPolicy?.hostClass?.() === 'myactivity') return;
    try {
      const styleManager = window.YouTubePlusDesignSystem?.StyleManager;
      if (!styleManager || typeof styleManager.add !== 'function') return;
      for (const id of BOOTSTRAP_STYLE_BUNDLE_IDS) {
        const css = getStyle(id);
        if (!css) continue;
        styleManager.add(id, css);
      }
    } catch (error) {
      logS(error);
      try {
        const logger = window.YouTubePlusLogger || window.YouTubeUtils?.logger || null;
        logger?.warn?.('design-system', 'Failed to bootstrap static style bundles', error);
      } catch (_e) {
        logS(_e);
        // Non-critical bootstrap path.
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.YouTubePlusDesignSystem = {
      ...(window.YouTubePlusDesignSystem || {}),
      getStyle,
    };
    bootstrapStaticStyles();
    if (document.readyState === 'loading') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        bootstrapStaticStyles,
        {
          once: true,
        },
        true
      );
    }
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'yt-navigate-finish',
      bootstrapStaticStyles,
      {
        passive: true,
      },
      true
    );

    // ---------------------------------------------------------------------------
    // Back-compat shim for settings-modal UI widget helpers.
    // Home: src/modal-handlers.js -> window.YouTubePlusModalHandlers.
    // Expose these as lazy getters on the final YouTubePlusDesignSystem object
    // so they are not evaluated or flattened into simple 'undefined' values
    // during the object spread / assignment above.
    // ---------------------------------------------------------------------------
    const WIDGET_BRIDGE_KEYS = [
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
      } catch (_e) {
        logS(_e);
        // Property may be non-configurable on test mocks.
      }
    }

    if (window.YouTubePlusDesignSystem) {
      if (window.YouTubePlusDesignSystem.StyleManager) {
        Object.freeze(window.YouTubePlusDesignSystem.StyleManager);
      }
      Object.freeze(window.YouTubePlusDesignSystem);
    }
  }
})();
