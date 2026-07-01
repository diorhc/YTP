/**
 * Settings Modal Helpers
 *
 * Canonical settings store + modal HTML helpers.
 *
 * Canonical responsibility: settings storage and access.
 *   - storage key registry
 *   - defaults registry
 *   - load / save with safe JSON I/O
 *   - get / set / update with dot-path support
 *   - feature-scoped accessors (getFeature / updateFeature)
 *   - subscriptions (path or feature id)
 *   - storage-shape migration from legacy keys
 *
 * The settings modal HTML helpers below are preserved unchanged for
 * backward compatibility with `window.YouTubePlusSettingsHelpers`.
 */

/* global GM_getValue, GM_setValue */

(function () {
  // ============================================================
  // CANONICAL SETTINGS STORE
  // ------------------------------------------------------------
  // settings-helpers.js is the canonical owner of settings state.
  // No other module should call localStorage / GM_getValue /
  // GM_setValue directly for the canonical keys registered in
  // STORAGE_KEYS. Other modules that need to read or write settings
  // should use `window.YouTubePlusSettingsStore` instead. Direct
  // localStorage usage outside this module is treated as legacy
  // and is migrated module-by-module in subsequent refactors.
  // ============================================================

  /** Storage key registry. Stable for backward compatibility. */
  const STORAGE_KEYS = Object.freeze({
    main: 'youtube_plus_settings', // canonical main settings (utils.SETTINGS_KEY)
    all: 'youtube_plus_all_settings_v2', // basic.js SettingsManager v2 legacy
    music: 'youtube-plus-music-settings', // music cross-domain (youtube.com <-> music.youtube.com)
  });

  /** YouTube Music settings defaults. Mirrors music.js. */
  const MUSIC_DEFAULTS = Object.freeze({
    enableMusic: true,
    immersiveSearchStyles: true,
    hoverStyles: true,
    playerSidebarStyles: true,
    playerBarStyles: true,
    centeredPlayerStyles: true,
    centeredPlayerBarStyles: true,
    miniPlayerStyles: true,
    scrollToTopStyles: true,
  });

  /**
   * Canonical settings defaults. Used to backfill missing fields on
   * load() and to provide stable defaults for getFeature().
   */
  const DEFAULTS = Object.freeze({
    enableDownload: true,
    enableZenStyles: true,
    enableSpeedControl: true,
    enableScreenshot: true,
    enableEnhanced: true,
    enableLoop: true,
    enableTabview: true,
    enableCommentTranslate: true,
    enablePlayAll: true,
    enableResumeTime: true,
    enableZoom: true,
    enableThumbnail: true,
    enablePlaylistSearch: true,
    enableScrollToTopButton: true,
    enableRememberManualQuality: true,
    hideSideGuide: false,
    zenStyles: {
      thumbnailHover: true,
      immersiveSearch: true,
      hideVoiceSearch: true,
      transparentHeader: true,
      hideSideGuide: true,
      cleanSideGuide: true,
      fixFeedLayout: true,
      compactFeed: true,
      betterCaptions: true,
      playerBlur: true,
      theaterEnhancements: true,

      sideVideosColumns: 0,
      sideVideosColumnsEnabled: false,
      themeVariant: 'glass',
    },
    speedControlHotkeys: { decrease: 'g', increase: 'h', reset: 'b' },
    loopHotkeys: { setPointA: 'k', setPointB: 'l', resetPoints: 'o' },
    downloadSites: { externalDownloader: true, ytdl: true, direct: true },
    downloadSiteCustomization: {
      externalDownloader: {
        name: 'SSYouTube',
        url: 'https://ssyoutube.com/watch?v={videoId}',
      },
    },
    music: { ...MUSIC_DEFAULTS },
  });

  /**
   * Formal key registry — every valid top-level settings key.
   * Derived from DEFAULTS at definition time. Used by `hasKey()`
   * to validate paths before get/set and to prevent accidental
   * typos or undocumented key additions from silently persisting.
   * @type {ReadonlySet<string>}
   */
  const KEY_REGISTRY = Object.freeze(new Set(Object.keys(DEFAULTS)));

  /**
   * Per-feature default subsets. Used by getFeature / updateFeature.
   * Typed as `Record<string, any>` so featureId can be indexed with an
   * arbitrary string; unknown ids return undefined and the caller
   * falls back to a generic read.
   * @type {Readonly<Record<string, any>>}
   */
  const FEATURE_DEFAULTS = Object.freeze({
    music: MUSIC_DEFAULTS,
    download: {
      enableDownload: true,
      downloadSites: { externalDownloader: true, ytdl: true, direct: true },
    },
    styles: DEFAULTS.zenStyles,
    speed: {
      enableSpeedControl: true,
      speedControlHotkeys: DEFAULTS.speedControlHotkeys,
    },
    loop: { enableLoop: true, loopHotkeys: DEFAULTS.loopHotkeys },
    enhanced: {
      enableEnhanced: true,
      enableTabview: true,
      enableCommentTranslate: true,
      enablePlayAll: true,
      enableResumeTime: true,
      enableZoom: true,
      enableThumbnail: true,
      enablePlaylistSearch: true,
      enableScrollToTopButton: true,
      enableRememberManualQuality: true,
    },
    screenshot: { enableScreenshot: true },
  });

  const storeLogger =
    (typeof window !== 'undefined' && window.YouTubeUtils && window.YouTubeUtils.logger) || null;
  const safeLogWarn = (
    /** @type {string} */ label,
    /** @type {string} */ msg,
    /** @type {*} */ err
  ) => {
    try {
      storeLogger?.warn?.(label, msg, err);
    } catch {}
  };

  /**
   * Read raw value from localStorage safely.
   * @param {string} key
   * @returns {string|null}
   */
  function readRaw(/** @type {string} */ key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      safeLogWarn('SettingsStore', 'readRaw failed', e);
      return null;
    }
  }

  /**
   * Write raw value to localStorage safely.
   * @param {string} key
   * @param {string} value
   * @returns {boolean}
   */
  function writeRaw(/** @type {string} */ key, /** @type {string} */ value) {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      safeLogWarn('SettingsStore', 'writeRaw failed', e);
      return false;
    }
  }

  /**
   * Remove a key from localStorage safely.
   * @param {string} key
   */
  function removeRaw(/** @type {string} */ key) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch (e) {
      safeLogWarn('SettingsStore', 'removeRaw failed', e);
    }
  }

  /**
   * Parse JSON safely with a fallback.
   * @param {string|null|undefined} raw
   * @param {*} fallback
   * @returns {*}
   */
  function safeJSONParse(/** @type {string|null|undefined} */ raw, /** @type {*} */ fallback) {
    if (typeof raw !== 'string' || !raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return fallback;
    }
  }

  /**
   * Get nested value via dot-path, with defensive access.
   * @param {Record<string, any>|null|undefined} obj
   * @param {string} path
   * @returns {*}
   */
  function getByPath(
    /** @type {Record<string, any>|null|undefined} */ obj,
    /** @type {string} */ path
  ) {
    if (!obj || typeof obj !== 'object' || !path) return undefined;
    return path
      .split('.')
      .filter(Boolean)
      .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  /**
   * Set nested value via dot-path, creating intermediate objects as needed.
   * Returns true on success.
   * @param {Record<string, any>} obj
   * @param {string} path
   * @param {*} value
   * @returns {boolean}
   */
  function setByPath(
    /** @type {Record<string, any>} */ obj,
    /** @type {string} */ path,
    /** @type {*} */ value
  ) {
    if (!obj || typeof obj !== 'object' || !path || typeof path !== 'string') return false;
    const keys = path.split('.').filter(Boolean);
    if (!keys.length) return false;
    /** @type {string|null|undefined} */
    const last = keys.pop();
    if (!last) return false;
    let cur = obj;
    for (const k of keys) {
      if (!Object.hasOwn(cur, k) || typeof cur[k] !== 'object' || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k];
    }
    cur[last] = value;
    return true;
  }

  /**
   * Deep-clone a JSON-safe value.
   * @param {*} value
   * @returns {*}
   */
  function cloneJSON(/** @type {*} */ value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }

  // ----- Music compatibility layer -----
  // YouTube Music settings are shared between youtube.com and
  // music.youtube.com. Storage is dual (GM_* + localStorage) for
  // cross-subdomain sync, and the shape includes legacy flag
  // migration. The store exposes a read/write pair that any caller
  // can use. The historical getMusicSettings() function below is
  // preserved unchanged for back-compat; the store's music
  // accessors are a parallel canonical path that new modules can
  // opt into without duplicating logic.

  /**
   * @param {string} key
   * @returns {string|null}
   */
  function readRawGM(/** @type {string} */ key) {
    try {
      if (typeof GM_getValue !== 'undefined') {
        const v = GM_getValue(key, null);
        return typeof v === 'string' && v ? v : null;
      }
    } catch {}
    return null;
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {boolean}
   */
  function writeRawGM(/** @type {string} */ key, /** @type {string} */ value) {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, value);
        return true;
      }
    } catch {}
    return false;
  }

  /**
   * Merge a parsed music settings object with defaults + legacy flags.
   * Mirrors music.js mergeMusicSettings and the historical
   * getMusicSettings() function to keep cross-module compatibility.
   * @param {any} parsed
   * @returns {Record<string, any>}
   */
  function mergeMusicWithDefaults(/** @type {any} */ parsed) {
    /** @type {Record<string, any>} */
    const merged = { ...MUSIC_DEFAULTS };
    if (!parsed || typeof parsed !== 'object') return merged;

    if (typeof parsed.enableMusic === 'boolean') merged.enableMusic = parsed.enableMusic;
    for (const key of Object.keys(MUSIC_DEFAULTS)) {
      if (key === 'enableMusic') continue;
      if (typeof parsed[key] === 'boolean') merged[key] = parsed[key];
    }

    // Legacy flags mapping
    if (typeof parsed.enableImmersiveSearch === 'boolean') {
      merged.immersiveSearchStyles = parsed.enableImmersiveSearch;
    }
    if (typeof parsed.enableSidebarHover === 'boolean') {
      merged.hoverStyles = parsed.enableSidebarHover;
    }
    if (typeof parsed.enableCenteredPlayer === 'boolean') {
      merged.centeredPlayerStyles = parsed.enableCenteredPlayer;
    }
    if (typeof parsed.enableScrollToTop === 'boolean') {
      merged.scrollToTopStyles = parsed.enableScrollToTop;
    }

    // Backward-compat: enable if any legacy flags are enabled
    const legacyEnabled = !!(
      parsed.enableMusicStyles ||
      parsed.enableMusicEnhancements ||
      parsed.enableImmersiveSearch ||
      parsed.enableSidebarHover ||
      parsed.enableCenteredPlayer ||
      parsed.enableScrollToTop
    );
    if (legacyEnabled && typeof parsed.enableMusic !== 'boolean') merged.enableMusic = true;

    return merged;
  }

  /**
   * Read YouTube Music settings from canonical store. Dual storage:
   * GM_* first (cross-subdomain), then localStorage. Returns defaults
   * if nothing is found.
   * @returns {Record<string, any>}
   */
  function readMusic() {
    // Prefer userscript-global storage so youtube.com and music.youtube.com share.
    const gm = readRawGM(STORAGE_KEYS.music);
    if (gm) {
      const parsed = safeJSONParse(gm, null);
      if (parsed && typeof parsed === 'object') return mergeMusicWithDefaults(parsed);
    }

    const ls = readRaw(STORAGE_KEYS.music);
    if (ls) {
      const parsed = safeJSONParse(ls, null);
      if (parsed && typeof parsed === 'object') return mergeMusicWithDefaults(parsed);
    }

    return { ...MUSIC_DEFAULTS };
  }

  /**
   * Persist YouTube Music settings to both GM_* and localStorage.
   * Returns the merged settings that were written.
   * @param {Record<string, any>|null|undefined} settings
   * @returns {Record<string, any>}
   */
  function writeMusic(/** @type {Record<string, any>|null|undefined} */ settings) {
    const merged =
      settings && typeof settings === 'object'
        ? mergeMusicWithDefaults(settings)
        : { ...MUSIC_DEFAULTS };
    const serialized = JSON.stringify(merged);
    writeRaw(STORAGE_KEYS.music, serialized);
    writeRawGM(STORAGE_KEYS.music, serialized);
    return merged;
  }

  // ----- Migration from basic.js SettingsManager (v2) -----
  // The legacy `youtube_plus_all_settings_v2` store used by
  // basic.js had a nested shape like
  //   { speedControl: { enabled }, download: { enabled } }
  // This function migrates a legacy object to the canonical flat
  // shape used by the rest of the codebase.
  /**
   * @param {any} parsed
   * @returns {Record<string, any>|null}
   */
  function migrateLegacyV2(/** @type {any} */ parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    /** @type {Record<string, any>} */
    const out = {};
    const sc = parsed.speedControl;
    if (sc && typeof sc.enabled === 'boolean') out.enableSpeedControl = sc.enabled;
    const ss = parsed.screenshot;
    if (ss && typeof ss.enabled === 'boolean') out.enableScreenshot = ss.enabled;
    const dl = parsed.download;
    if (dl && typeof dl.enabled === 'boolean') out.enableDownload = dl.enabled;
    if (parsed.downloadSites && typeof parsed.downloadSites === 'object') {
      out.downloadSites = cloneJSON(parsed.downloadSites);
    }
    return Object.keys(out).length ? out : null;
  }

  // ----- Subscriptions -----
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map();
  /**
   * @param {string} path
   * @param {*} value
   */
  function notifySubscribers(/** @type {string} */ path, /** @type {*} */ value) {
    if (!subscribers.size) return;
    const set = subscribers.get(path);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(value, path);
      } catch (e) {
        safeLogWarn('SettingsStore', 'subscriber callback failed', e);
      }
    }
  }

  // ----- Public API -----

  /**
   * In-memory cache of the last `load()` result. Set after a load
   * and cleared by `save()`, by cross-tab `storage` events, and by
   * any `youtube-plus-settings-updated` dispatch so the next
   * `get()`/`set()`/`update()` call returns the cached object
   * without re-parsing localStorage JSON.
   * @type {Record<string, any>|null}
   */
  let _cache = null;

  /**
   * Load the canonical settings object. Falls back to defaults for
   * any missing keys. Migrates from `youtube_plus_all_settings_v2`
   * (basic.js SettingsManager legacy) if the canonical key is
   * missing. The result is cached so repeated calls within the
   * same save-cycle skip the localStorage read, JSON parse,
   * defaults merge, and deep clone.
   * @returns {Record<string, any>}
   */
  function load() {
    if (_cache) return _cache;

    const raw = readRaw(STORAGE_KEYS.main);
    /** @type {any} */
    let parsed = safeJSONParse(raw, null);
    let migrated = false;

    if (!parsed || typeof parsed !== 'object') {
      const legacyRaw = readRaw(STORAGE_KEYS.all);
      const legacyParsed = safeJSONParse(legacyRaw, null);
      const migratedLegacy = migrateLegacyV2(legacyParsed);
      if (migratedLegacy) {
        parsed = migratedLegacy;
        migrated = true;
      }
    }

    /** @type {Record<string, any>} */
    const out = cloneJSON(DEFAULTS);
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(parsed)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        const v = parsed[k];
        if (
          v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          out[k] &&
          typeof out[k] === 'object' &&
          !Array.isArray(out[k])
        ) {
          out[k] = { ...out[k], ...cloneJSON(v) };
        } else {
          out[k] = cloneJSON(v);
        }
      }
    }

    if (migrated) {
      // Persist the migrated shape under the canonical key so future
      // loads are fast and we don't keep re-running migration.
      try {
        writeRaw(STORAGE_KEYS.main, JSON.stringify(out));
      } catch {}
    }

    _cache = out;
    return out;
  }

  /**
   * Save the canonical settings object. Dispatches the
   * `youtube-plus-settings-updated` event so modules that listen to
   * it (time.js, zoom.js, playlist-search.js, enhanced.js, etc.)
   * keep working without changes. Invalidates the in-memory cache
   * so the next `load()` re-reads from localStorage.
   * @param {Record<string, any>|null|undefined} settings
   */
  function save(/** @type {Record<string, any>|null|undefined} */ settings) {
    const safe = settings && typeof settings === 'object' ? settings : {};
    const serialized = JSON.stringify(safe);
    writeRaw(STORAGE_KEYS.main, serialized);
    _cache = null;

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('youtube-plus-settings-updated', { detail: safe }));
      } catch {}
    }
  }

  /**
   * Get a setting by dot-path, with optional default.
   * @param {string} path
   * @param {*} [defaultValue]
   * @returns {*}
   */
  function get(/** @type {string} */ path, /** @type {*} */ defaultValue) {
    const v = getByPath(load(), path);
    return v === undefined ? defaultValue : v;
  }

  // ----- Cache invalidation on external writes -----
  // `storage` fires in other tabs/windows that mutate localStorage; we
  // must drop the cache so the next read in this tab sees the new value.
  // `youtube-plus-settings-updated` is dispatched by this module on every
  // save(), but it's also a public coordination point for any code path
  // that may have written the canonical key out-of-band. Both listeners
  // are installed once per IIFE; they're window-scoped and live for the
  // lifetime of the page, so no per-instance teardown is needed.
  if (typeof window !== 'undefined') {
    try {
      window.addEventListener('storage', () => {
        _cache = null;
      });
    } catch (_e) {
      void _e;
    }
    try {
      window.addEventListener('youtube-plus-settings-updated', () => {
        _cache = null;
      });
    } catch (_e) {
      void _e;
    }
  }

  /**
   * Set a setting by dot-path, persist, and notify subscribers.
   * @param {string} path
   * @param {*} value
   * @returns {boolean}
   */
  function set(/** @type {string} */ path, /** @type {*} */ value) {
    const current = load();
    if (!setByPath(current, path, value)) return false;
    save(current);
    notifySubscribers(path, value);
    return true;
  }

  /**
   * Patch a setting by dot-path. The patch is shallow-merged into
   * the existing object at `path` (if it is an object) or replaces
   * the value (if it is a primitive). Persists and notifies.
   * @param {string} path
   * @param {Record<string, any>|*} patch
   * @returns {boolean}
   */
  function update(/** @type {string} */ path, /** @type {Record<string, any>|*} */ patch) {
    const current = load();
    const existing = getByPath(current, path);
    let next;
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      patch &&
      typeof patch === 'object' &&
      !Array.isArray(patch)
    ) {
      next = { ...existing, ...patch };
    } else {
      next = patch;
    }
    if (!setByPath(current, path, next)) return false;
    save(current);
    notifySubscribers(path, next);
    return true;
  }

  /**
   * Get a feature's settings subset. Music uses the dual-storage
   * music bridge; other features return the canonical store values
   * overlaid on the feature defaults.
   * @param {string} featureId
   * @returns {Record<string, any>}
   */
  function getFeature(/** @type {string} */ featureId) {
    if (featureId === 'music') return getMusicSettings();
    const defaults = FEATURE_DEFAULTS[featureId];
    const current = load();
    if (!defaults) {
      return current[featureId] != null ? cloneJSON(current[featureId]) : {};
    }
    /** @type {Record<string, any>} */
    const out = cloneJSON(defaults);
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(current, k)) {
        out[k] = cloneJSON(current[k]);
      }
    }
    return out;
  }

  /**
   * Update a feature's settings subset. Patches are shallow-merged
   * into the feature's top-level keys. Persists and notifies.
   * @param {string} featureId
   * @param {Record<string, any>|null|undefined} patch
   * @returns {boolean}
   */
  function updateFeature(
    /** @type {string} */ featureId,
    /** @type {Record<string, any>|null|undefined} */ patch
  ) {
    if (!(featureId && patch) || typeof patch !== 'object') return false;
    if (featureId === 'music') {
      // Delegate to the canonical music bridge so all music writes
      // share a single notification + persistence path.
      return updateMusicSettings(patch);
    }
    const defaults = FEATURE_DEFAULTS[featureId];
    if (!defaults) return false;
    const current = load();
    /** @type {Record<string, any>} */
    const out = cloneJSON(defaults);
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(current, k) && current[k] !== null && current[k] !== undefined) {
        out[k] = current[k];
      }
    }
    Object.assign(out, patch);
    for (const k of Object.keys(out)) {
      current[k] = out[k];
    }
    save(current);
    notifySubscribers(featureId, out);
    return true;
  }

  // ============================================================
  // CANONICAL MUSIC BRIDGE
  // ------------------------------------------------------------
  // YouTube Music settings are shared between youtube.com and
  // music.youtube.com. Persistence is dual (GM_* + localStorage)
  // for cross-subdomain sync, and the merged shape includes
  // legacy flag migration. These four helpers are the canonical
  // public surface for music settings — new code should call
  // them instead of touching GM_*/localStorage directly.
  // ============================================================

  /**
   * Read YouTube Music settings from the canonical store. Returns
   * a fresh merged object on every call. Falls back to defaults
   * if nothing is stored.
   * @returns {Record<string, any>}
   */
  function getMusicSettings() {
    return readMusic();
  }

  /**
   * Persist the full music settings object. The provided value is
   * merged with defaults + legacy flags before being written to
   * both GM_* and localStorage. Returns the merged value that was
   * actually written.
   * @param {Record<string, any>|null|undefined} settings
   * @returns {Record<string, any>}
   */
  function saveMusicSettings(/** @type {Record<string, any>|null|undefined} */ settings) {
    return writeMusic(settings);
  }

  /**
   * Shallow-merge a patch into the current music settings, persist
   * to GM_* + localStorage, notify `subscribe('music', ...)` and
   * dispatch the unified `youtube-plus-settings-updated` event.
   * @param {Record<string, any>|null|undefined} patch
   * @returns {boolean}
   */
  function updateMusicSettings(/** @type {Record<string, any>|null|undefined} */ patch) {
    if (!patch || typeof patch !== 'object') return false;
    const next = { ...readMusic(), ...patch };
    writeMusic(next);
    notifySubscribers('music', next);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('youtube-plus-settings-updated', {
            detail: { music: next },
          })
        );
      } catch {}
    }
    return true;
  }

  /**
   * Subscribe to in-page music settings changes. Returns an
   * unsubscribe function. Note: cross-subdomain changes delivered
   * via `GM_addValueChangeListener` are not captured here — the
   * music module owns that listener for live sync.
   * @param {(value: Record<string, any>, target: string) => void} callback
   * @returns {() => void}
   */
  function subscribeMusicSettings(
    /** @type {(value: Record<string, any>, target: string) => void} */ callback
  ) {
    return subscribe('music', /** @type {any} */ (callback));
  }

  /**
   * Subscribe to changes for a path or feature id. Returns an
   * unsubscribe function. The callback receives `(value, target)`.
   * @param {string} pathOrFeature
   * @param {(value: any, target: string) => void} callback
   * @returns {() => void}
   */
  function subscribe(
    /** @type {string} */ pathOrFeature,
    /** @type {(value: any, target: string) => void} */ callback
  ) {
    if (typeof pathOrFeature !== 'string' || typeof callback !== 'function') {
      return () => {};
    }
    let set = subscribers.get(pathOrFeature);
    if (!set) {
      set = new Set();
      subscribers.set(pathOrFeature, set);
    }
    set.add(/** @type {Function} */ (/** @type {unknown} */ (callback)));
    return () => {
      const s = subscribers.get(pathOrFeature);
      if (!s) return;
      s.delete(/** @type {Function} */ (/** @type {unknown} */ (callback)));
      if (!s.size) subscribers.delete(pathOrFeature);
    };
  }

  /**
   * Reset to defaults. Removes the canonical key and dispatches an
   * update event. Use with care — module-level caches (e.g.
   * music.js snapshot) are not touched; callers should reload
   * after reset.
   */
  function reset() {
    removeRaw(STORAGE_KEYS.main);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('youtube-plus-settings-updated', {
            detail: cloneJSON(DEFAULTS),
          })
        );
      } catch {}
    }
  }

  /** Internal helpers exposed for testing and advanced callers. */
  const _internals = Object.freeze({
    STORAGE_KEYS,
    DEFAULTS,
    MUSIC_DEFAULTS,
    FEATURE_DEFAULTS,
    KEY_REGISTRY,
    readMusic,
    writeMusic,
    migrateLegacyV2,
    mergeMusicWithDefaults,
  });

  /**
   * Validate that a top-level settings key is registered in KEY_REGISTRY.
   * Accepts dot-paths and validates only the root segment.
   * @param {string} key - A settings key or dot-path (e.g. "enableDownload" or "zenStyles.themeVariant")
   * @returns {boolean}
   */
  function hasKey(/** @type {string} */ key) {
    if (typeof key !== 'string' || !key) return false;
    const root = key.split('.')[0];
    return KEY_REGISTRY.has(root);
  }

  /** Canonical settings store. The single source of truth for the
   *  public settings API. */
  const SettingsStore = Object.freeze({
    // Storage key / defaults registries (read-only).
    STORAGE_KEYS,
    DEFAULTS,
    MUSIC_DEFAULTS,
    FEATURE_DEFAULTS,
    KEY_REGISTRY,
    // Core I/O.
    load,
    save,
    // Generic access.
    get,
    set,
    update,
    hasKey,
    // Feature-scoped access.
    getFeature,
    updateFeature,
    // Subscriptions.
    subscribe,
    // Music bridge (canonical accessors for youtube-plus-music-settings).
    getMusicSettings,
    saveMusicSettings,
    updateMusicSettings,
    subscribeMusicSettings,
    // Lifecycle.
    reset,
    // Advanced (testing / migration tooling).
    _internals,
  });

  // ============================================================
  // SETTINGS MODAL HTML HELPERS (preserved unchanged)
  // ------------------------------------------------------------
  // These functions are part of the existing public API on
  // `window.YouTubePlusSettingsHelpers`. They are intentionally
  // left untouched in this refactor so that callers (notably
  // basic.js#createSettingsModal) continue to work without
  // changes.
  // ============================================================

  /**
   * Creates the sidebar navigation HTML
   * @param {Function} t - Translation function
   * @returns {string} Sidebar HTML
   */
  function createSettingsSidebar(t) {
    return `
    <div class="ytp-plus-settings-nav ytp-plus-settings-nav-rail">
      ${createNavItem('basic', t('basicTab'), createBasicIcon(), true)}
      ${createNavItem('advanced', t('advancedTab'), createAdvancedIcon())}
      ${createNavItem('experimental', t('experimentalTab'), createExperimentalIcon())}
      ${createNavItem('voting', tr(t, 'votingTab'), createVotingIcon())}
      ${createNavItem('report', t('reportTab'), createReportIcon())}
      ${createNavItem('about', t('aboutTab'), createAboutIcon())}
    </div>
  `;
  }

  /**
   * Escape plain text for HTML interpolation. Used by the modal
   * template helpers below so user-controlled values (translation
   * lookups, custom downloader names/URLs) cannot break out of an
   * attribute or inject script tags.
   * @param {string} str
   * @returns {string}
   */
  function escapeHTML(/** @type {string} */ str) {
    if (window.YouTubeSafeDOM?.escapeHTML) return window.YouTubeSafeDOM.escapeHTML(str);
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Creates a single navigation item
   * @param {string} section - Section identifier
   * @param {string} label - Nav item label
   * @param {string} icon - SVG icon
   * @param {boolean} active - Whether this item is active
   * @returns {string} Nav item HTML
   */
  function createNavItem(section, label, icon, active = false) {
    const activeClass = active ? ' active' : '';
    const sectionEsc = escapeHTML(section);
    const labelEsc = escapeHTML(label);
    return `
    <div class="ytp-plus-settings-nav-item${activeClass}" data-section="${sectionEsc}" data-label="${labelEsc}" title="${labelEsc}" aria-label="${labelEsc}">
      ${icon}
      <span class="ytp-plus-settings-nav-item-label">${labelEsc}</span>
    </div>
  `;
  }

  /**
   * SVG icon creators.
   * Each returns an inline SVG string used by the settings sidebar.
   */

  /**
   * @returns {string} Basic section icon SVG
   */
  function createBasicIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12.2039C2 9.91549 2 8.77128 2.5192 7.82274C3.0384 6.87421 3.98695 6.28551 5.88403 5.10813L7.88403 3.86687C9.88939 2.62229 10.8921 2 12 2C13.1079 2 14.1106 2.62229 16.116 3.86687L18.116 5.10812C20.0131 6.28551 20.9616 6.87421 21.4808 7.82274C22 8.77128 22 9.91549 22 12.2039V13.725C22 17.6258 22 19.5763 20.8284 20.7881C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.7881C2 19.5763 2 17.6258 2 13.725V12.2039Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M15 18H9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} Advanced section icon SVG
   */
  function createAdvancedIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12" stroke="currentColor" stroke-width="1.5"></path> <path d="M2 14C2 11.1997 2 9.79961 2.54497 8.73005C3.02433 7.78924 3.78924 7.02433 4.73005 6.54497C5.79961 6 7.19974 6 10 6H14C16.8003 6 18.2004 6 19.27 6.54497C20.2108 7.02433 20.9757 7.78924 21.455 8.73005C22 9.79961 22 11.1997 22 14C22 16.8003 22 18.2004 21.455 19.27C20.9757 20.2108 20.2108 20.9757 19.27 21.455C18.2004 22 16.8003 22 14 22H10C7.19974 22 5.79961 22 4.73005 21.455C3.78924 20.9757 3.02433 20.2108 2.54497 19.27C2 18.2004 2 16.8003 2 14Z" stroke="currentColor" stroke-width="1.5"></path> <path d="M9.5 14.4L10.9286 16L14.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} Experimental section icon SVG
   */
  function createExperimentalIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M9.74872 2.49415L18.1594 7.31987M9.74872 2.49415L2.65093 14.7455C1.31093 17.0584 2.10615 20.0159 4.42709 21.3513C6.74803 22.6867 9.7158 21.8942 11.0558 19.5813L12.5511 17.0003L14.1886 14.1738L15.902 11.2163L18.1594 7.31987M9.74872 2.49415L8.91283 2M18.1594 7.31987L19 7.80374" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M15.9021 11.2164L13.3441 9.74463M14.1887 14.1739L9.98577 11.7557M12.5512 17.0004L9.93848 15.4972" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M22 14.9166C22 16.0672 21.1046 16.9999 20 16.9999C18.8954 16.9999 18 16.0672 18 14.9166C18 14.1967 18.783 13.2358 19.3691 12.6174C19.7161 12.2512 20.2839 12.2512 20.6309 12.6174C21.217 13.2358 22 14.1967 22 14.9166Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  /**
   * @returns {string} Report section icon SVG
   */
  function createReportIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M4 6V19C4 20.6569 5.34315 22 7 22H17C18.6569 22 20 20.6569 20 19V9C20 7.34315 18.6569 6 17 6H4ZM4 6V5" stroke="currentColor" stroke-width="1.5"></path> <path d="M18 6.00002V6.75002H18.75V6.00002H18ZM15.7172 2.32614L15.6111 1.58368L15.7172 2.32614ZM4.91959 3.86865L4.81353 3.12619H4.81353L4.91959 3.86865ZM5.07107 6.75002H18V5.25002H5.07107V6.75002ZM18.75 6.00002V4.30604H17.25V6.00002H18.75ZM15.6111 1.58368L4.81353 3.12619L5.02566 4.61111L15.8232 3.0686L15.6111 1.58368ZM4.81353 3.12619C3.91638 3.25435 3.25 4.0227 3.25 4.92895H4.75C4.75 4.76917 4.86749 4.63371 5.02566 4.61111L4.81353 3.12619ZM18.75 4.30604C18.75 2.63253 17.2678 1.34701 15.6111 1.58368L15.8232 3.0686C16.5763 2.96103 17.25 3.54535 17.25 4.30604H18.75ZM5.07107 5.25002C4.89375 5.25002 4.75 5.10627 4.75 4.92895H3.25C3.25 5.9347 4.06532 6.75002 5.07107 6.75002V5.25002Z" fill="currentColor"></path> <path opacity="0.5" d="M8 12H16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M8 15.5H13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> </svg>
  `;
  }

  /**
   * @returns {string} About section icon SVG
   */
  function createAboutIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M15.5 9L15.6716 9.17157C17.0049 10.5049 17.6716 11.1716 17.6716 12C17.6716 12.8284 17.0049 13.4951 15.6716 14.8284L15.5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M13.2942 7.17041L12.0001 12L10.706 16.8297" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path d="M8.49994 9L8.32837 9.17157C6.99504 10.5049 6.32837 11.1716 6.32837 12C6.32837 12.8284 6.99504 13.4951 8.32837 14.8284L8.49994 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C22 4.92893 22 7.28595 22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12Z" stroke="currentColor" stroke-width="1.5"></path> </svg>
  `;
  }

  /**
   * @returns {string} Voting section icon SVG
   */
  function createVotingIcon() {
    return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <circle cx="12" cy="6" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path opacity="0.5" d="M15 13.3271C14.0736 13.1162 13.0609 13 12 13C7.58172 13 4 15.0147 4 17.5C4 19.9853 4 22 12 22C17.6874 22 19.3315 20.9817 19.8068 19.5" stroke="currentColor" stroke-width="1.5"></path> <circle cx="18" cy="16" r="4" stroke="currentColor" stroke-width="1.5"></circle> <path d="M18 14.6667V17.3333" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M16.6665 16L19.3332 16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path> </svg>
  `;
  }

  /**
   * Creates a settings checkbox item
   * @param {string} label - Item label
   * @param {string} description - Item description
   * @param {string} setting - Setting data attribute
   * @param {boolean} checked - Whether checkbox is checked
   * @returns {string} Settings item HTML
   */
  /**
   * Read a boolean setting from a legacy module-specific localStorage key.
   * Handles both JSON object format ({ enabled: true }) and plain string format ('true'/'false').
   * @param {string} key - localStorage key
   * @param {boolean} defaultValue - Default value if key is missing or unreadable
   * @returns {boolean}
   */
  function readLegacyModuleSetting(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && 'enabled' in parsed) {
          return Boolean(parsed.enabled);
        }
      } catch (_jsonErr) {
        // Not JSON — treat as plain string
      }
      return raw !== 'false';
    } catch (_e) {
      return defaultValue;
    }
  }

  /**
   * Read a shortcut object from a legacy module-specific localStorage key.
   * @param {string} key - localStorage key
   * @param {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }} defaultValue
   * @returns {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }}
   */
  function readLegacyShortcutSetting(key, defaultValue) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaultValue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.shortcut) {
        return { ...defaultValue, ...parsed.shortcut };
      }
    } catch (_e) {}
    return defaultValue;
  }

  /**
   * Read submenu expanded state from localStorage.
   * @param {string} key - Submenu key (e.g. 'pip', 'timecode')
   * @returns {boolean|null} - true/false if stored, null if missing
   */
  function readSubmenuExpanded(/** @type {string} */ key) {
    try {
      const raw = localStorage.getItem('ytp-plus-submenu-states');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed[key] === 'boolean') return parsed[key];
    } catch (_e) {}
    return null;
  }

  /**
   * Build shortcut editor HTML for PiP/Timecode submenu.
   * @param {string} id - Prefix for element IDs (e.g. 'pip', 'timecode')
   * @param {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, key: string }} shortcut
   * @param {Function} t - Translation function
   * @returns {string} HTML string
   */
  function buildShortcutEditorHTML(id, shortcut, t) {
    const formatLabel = (/** @type {string} */ value) => {
      const formatter = window.YouTubePlusDesignSystem?.formatModifierComboLabel;
      if (typeof formatter === 'function') {
        return formatter(value, {
          noneLabel: t('none'),
          translatePart: (/** @type {string} */ part) => t(part.toLowerCase()),
        });
      }
      if (value === 'none') return t('none');
      return value
        .split('+')
        .map((/** @type {string} */ k) => t(k.toLowerCase()))
        .map((/** @type {string} */ k) => k.charAt(0).toUpperCase() + k.slice(1))
        .join('+');
    };

    const resolveValue = (
      /** @type {{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean }} */ sc
    ) => {
      const resolver = window.YouTubePlusDesignSystem?.resolveModifierComboValue;
      if (typeof resolver === 'function') return resolver(sc);
      return 'none';
    };

    const modifierValue = resolveValue(shortcut);
    const optionItems =
      window.YouTubePlusDesignSystem?.buildModifierComboOptionItems?.(modifierValue, formatLabel) ||
      '';
    const dropdownItems =
      window.YouTubePlusDesignSystem?.buildModifierComboDropdownItems?.(
        modifierValue,
        formatLabel
      ) || '';

    return `
      <select id="${id}-modifier-combo" class="${id}-hidden-select">
        ${optionItems}
      </select>

      <div class="glass-dropdown" id="${id}-modifier-dropdown" tabindex="0" role="listbox" aria-expanded="false">
        <button class="glass-dropdown__toggle" type="button" aria-haspopup="listbox">
          <span class="glass-dropdown__label">${formatLabel(modifierValue)}</span>
          <svg class="glass-dropdown__chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <ul class="glass-dropdown__list" role="presentation">
          ${dropdownItems}
        </ul>
      </div>

      <span class="${id}-shortcut-plus">+</span>
      <input type="text" id="${id}-key" class="${id}-key-input" value="${escapeHTML(shortcut.key)}" maxlength="1" autocomplete="off" spellcheck="false">
    `;
  }

  /**
   * Creates a simple checkbox settings item.
   * @param {string} label - Item label
   * @param {string} description - Item description
   * @param {string} setting - Setting data attribute value
   * @param {boolean} checked - Whether the checkbox is initially checked
   * @returns {string} Settings item HTML
   */
  function createSettingsItem(label, description, setting, checked) {
    const settingEsc = escapeHTML(setting);
    const inputId = `ytp-plus-setting-${settingEsc}`;
    return `
    <div class="ytp-plus-settings-item">
      <div>
        <label class="ytp-plus-settings-item-label" for="${inputId}">${escapeHTML(label)}</label>
        <div class="ytp-plus-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <input type="checkbox" id="${inputId}" class="ytp-plus-settings-checkbox" data-setting="${settingEsc}" ${checked ? 'checked' : ''}>
    </div>
  `;
  }

  /**
   * Creates a native `<select>` settings item.
   * @param {string} label - Item label
   * @param {string} description - Item description
   * @param {string} setting - Setting data attribute value
   * @param {string|number} value - Currently selected option value
   * @param {Array<{value: string|number, label: string}>} options - Available options
   * @returns {string} Settings item HTML
   */
  function createSettingsSelect(
    /** @type {string} */ label,
    /** @type {string} */ description,
    /** @type {string} */ setting,
    /** @type {string|number} */ value,
    /** @type {Array<{value: string|number, label: string}>} */ options
  ) {
    const settingEsc = escapeHTML(setting);
    const inputId = `ytp-plus-setting-${settingEsc}`;
    const opts = options
      .map(
        o =>
          `<option value="${escapeHTML(String(o.value))}"${String(value) === String(o.value) ? ' selected' : ''}>${escapeHTML(o.label)}</option>`
      )
      .join('');
    return `
    <div class="ytp-plus-settings-item">
      <div>
        <label class="ytp-plus-settings-item-label" for="${inputId}">${escapeHTML(label)}</label>
        <div class="ytp-plus-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <select id="${inputId}" class="ytp-plus-settings-select" data-setting="${settingEsc}">${opts}</select>
    </div>
  `;
  }

  /**
   * Creates a checkbox row with nested submenu select.
   * @param {string} label
   * @param {string} description
   * @param {string} toggleSetting
   * @param {boolean} checked
   * @param {string} submenuKey
   * @param {string} selectLabel
   * @param {string} selectDescription
   * @param {string} selectSetting
   * @param {any} selectValue
   * @param {Array<{value: any, label: string}>} options
   * @returns {string}
   */
  function createSettingsToggleWithSelectSubmenu(
    label,
    description,
    toggleSetting,
    checked,
    submenuKey,
    selectLabel,
    selectDescription,
    selectSetting,
    selectValue,
    options
  ) {
    const toggleSettingEsc = escapeHTML(toggleSetting);
    const submenuKeyEsc = escapeHTML(submenuKey);
    const toggleInputId = `ytp-plus-setting-${toggleSettingEsc}`;
    return `
    <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
      <div>
        <label class="ytp-plus-settings-item-label" for="${toggleInputId}">${escapeHTML(label)}</label>
        <div class="ytp-plus-settings-item-description">${escapeHTML(description)}</div>
      </div>
      <div class="ytp-plus-settings-item-actions">
        <button
          type="button"
          class="ytp-plus-submenu-toggle"
          data-submenu="${submenuKeyEsc}"
          aria-label="Toggle ${submenuKeyEsc} submenu"
          aria-expanded="${checked ? 'true' : 'false'}"
          ${checked ? '' : 'disabled'}
          style="display:${checked ? 'inline-flex' : 'none'};"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <input type="checkbox" id="${toggleInputId}" class="ytp-plus-settings-checkbox" data-setting="${toggleSettingEsc}" ${checked ? 'checked' : ''} aria-label="${escapeHTML(label)}">
      </div>
    </div>
    <div class="style-side-videos-submenu" data-submenu="${submenuKeyEsc}" style="display:${checked ? 'block' : 'none'};">
      <div class="glass-card ytp-plus-settings-submenu-card">
        ${createSettingsSelect(selectLabel, selectDescription, selectSetting, selectValue, options)}
      </div>
    </div>
  `;
  }

  /**
   * Creates the download site option section
   * @param {{ key: string; name: string; description: string; checked: boolean; hasControls: boolean; controls?: string }} site - Site configuration
   * @param {Function} _t - Translation function (unused, kept for API consistency)
   * @returns {string} Download site HTML
   */
  function createDownloadSiteOption(site, _t) {
    const { key, name, description, checked, hasControls, controls } = site;
    const keyEsc = escapeHTML(key);
    const inputId = `download-site-${keyEsc}`;

    return `
    <div class="download-site-option">
      <div class="download-site-header">
        <label for="${inputId}" class="download-site-label">
          <div class="download-site-name">${escapeHTML(name)}</div>
          <div class="download-site-desc">${escapeHTML(description)}</div>
        </label>
        <input type="checkbox" id="${inputId}" class="ytp-plus-settings-checkbox" data-setting="downloadSite_${keyEsc}" ${checked ? 'checked' : ''}>
      </div>
      ${hasControls ? `<div class="download-site-controls" style="display:${checked ? 'flex' : 'none'};">${controls}</div>` : ''}
    </div>
  `;
  }

  /**
   * Creates External Downloader customization controls
   * @param {{ name?: string; url?: string }} customization - External downloader customization settings
   * @param {Function} t - Translation function
   * @returns {string} Controls HTML
   */
  function createExternalDownloaderControls(customization, t) {
    const name = customization?.name || 'SSYouTube';
    const url = customization?.url || 'https://ssyoutube.com/watch?v={videoId}';
    const siteNameLabel = t('siteName');
    const urlTemplateLabel = t('urlTemplate');

    return `
    <input type="text" placeholder="${escapeHTML(siteNameLabel)}" value="${escapeHTML(name)}"
        data-site="externalDownloader" data-field="name" class="download-site-input"
        aria-label="${escapeHTML(siteNameLabel)}">
    <input type="text" placeholder="${escapeHTML(urlTemplateLabel)}" value="${escapeHTML(url)}"
      data-site="externalDownloader" data-field="url" class="download-site-input small"
      aria-label="${escapeHTML(urlTemplateLabel)}">
    <div class="download-site-cta">
      <button class="glass-button" id="download-externalDownloader-save">${escapeHTML(t('saveButton'))}</button>
      <button class="glass-button danger" id="download-externalDownloader-reset">${escapeHTML(t('resetButton'))}</button>
    </div>
  `;
  }

  /**
   * Creates YTDL controls
   * @returns {string} Controls HTML
   */
  function createYTDLControls() {
    return `
    <div class="download-site-cta one-btn">
      <button class="glass-button" id="open-ytdl-github">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
        GitHub
      </button>
    </div>
  `;
  }

  /**
   * Creates the download submenu with all site options
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Download submenu HTML
   */
  function createDownloadSubmenu(settings, t) {
    const display = settings.enableDownload ? 'block' : 'none';

    const sites = [
      {
        key: 'externalDownloader',
        name: settings.downloadSiteCustomization?.externalDownloader?.name || 'SSYouTube',
        description: t('customDownloader'),
        checked: settings.downloadSites?.externalDownloader,
        hasControls: true,
        controls: createExternalDownloaderControls(
          settings.downloadSiteCustomization?.externalDownloader,
          t
        ),
      },
      {
        key: 'ytdl',
        name: t('byYTDL'),
        description: t('customDownload'),
        checked: settings.downloadSites?.ytdl,
        hasControls: true,
        controls: createYTDLControls(),
      },
      {
        key: 'direct',
        name: t('directDownload'),
        description: t('directDownloadDesc'),
        checked: settings.downloadSites?.direct,
        hasControls: false,
      },
    ];

    return `
    <div class="download-submenu" data-submenu="download" style="display:${display};">
      <div class="glass-card download-submenu-container">
        ${sites.map(site => createDownloadSiteOption(site, t)).join('')}
      </div>
    </div>
  `;
  }

  /**
   * Small translation helper.
   * @param {Function} t - Translation function
   * @param {string} key - Translation key
   * @returns {string}
   */
  function tr(t, key) {
    try {
      const v = t(key);
      if (typeof v === 'string' && v && v !== key) return v;
    } catch (_e) {
      window.YouTubePlusErrorBoundary?.logError?.(
        _e instanceof Error ? _e : new Error(String(_e)),
        { module: 'SettingsHelpers' }
      );
    }
    return key;
  }

  /**
   * Creates the styles submenu (style.js feature flags)
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createStyleSubmenu(settings, t) {
    const display = settings.enableZenStyles ? 'block' : 'none';
    const rawSideVideosColumns = Number(settings.zenStyles?.sideVideosColumns);
    const sideVideosColumnsValue = Number.isFinite(rawSideVideosColumns)
      ? Math.max(0, Math.min(2, rawSideVideosColumns))
      : 0;
    const sideVideosColumnsEnabled =
      settings.zenStyles?.sideVideosColumnsEnabled === true || sideVideosColumnsValue > 0;

    const rows = [
      {
        label: tr(t, 'zenStyleThumbnailHoverLabel'),
        desc: tr(t, 'zenStyleThumbnailHoverDesc'),
        key: 'zenStyles.thumbnailHover',
        value: settings.zenStyles?.thumbnailHover,
      },
      {
        label: tr(t, 'zenStyleImmersiveSearchLabel'),
        desc: tr(t, 'zenStyleImmersiveSearchDesc'),
        key: 'zenStyles.immersiveSearch',
        value: settings.zenStyles?.immersiveSearch,
      },
      {
        label: tr(t, 'zenStyleHideVoiceSearchLabel'),
        desc: tr(t, 'zenStyleHideVoiceSearchDesc'),
        key: 'zenStyles.hideVoiceSearch',
        value: settings.zenStyles?.hideVoiceSearch,
      },
      {
        label: tr(t, 'zenStyleTransparentHeaderLabel'),
        desc: tr(t, 'zenStyleTransparentHeaderDesc'),
        key: 'zenStyles.transparentHeader',
        value: settings.zenStyles?.transparentHeader,
      },
      {
        label: tr(t, 'zenStyleHideSideGuideLabel'),
        desc: tr(t, 'zenStyleHideSideGuideDesc'),
        key: 'zenStyles.hideSideGuide',
        value: settings.zenStyles?.hideSideGuide,
      },
      {
        label: tr(t, 'zenStyleCleanSideGuideLabel'),
        desc: tr(t, 'zenStyleCleanSideGuideDesc'),
        key: 'zenStyles.cleanSideGuide',
        value: settings.zenStyles?.cleanSideGuide,
      },
      {
        label: tr(t, 'zenStyleFixFeedLayoutLabel'),
        desc: tr(t, 'zenStyleFixFeedLayoutDesc'),
        key: 'zenStyles.fixFeedLayout',
        value: settings.zenStyles?.fixFeedLayout,
      },
      {
        label: tr(t, 'zenStyleCompactFeedLabel'),
        desc: tr(t, 'zenStyleCompactFeedDesc'),
        key: 'zenStyles.compactFeed',
        value: settings.zenStyles?.compactFeed,
      },
      {
        label: tr(t, 'zenStyleBetterCaptionsLabel'),
        desc: tr(t, 'zenStyleBetterCaptionsDesc'),
        key: 'zenStyles.betterCaptions',
        value: settings.zenStyles?.betterCaptions,
      },
      {
        label: tr(t, 'zenStylePlayerBlurLabel'),
        desc: tr(t, 'zenStylePlayerBlurDesc'),
        key: 'zenStyles.playerBlur',
        value: settings.zenStyles?.playerBlur,
      },
      {
        label: tr(t, 'zenStyleTheaterEnhancementsLabel'),
        desc: tr(t, 'zenStyleTheaterEnhancementsDesc'),
        key: 'zenStyles.theaterEnhancements',
        value: settings.zenStyles?.theaterEnhancements,
      },
    ];

    return `
    <div class="style-submenu" data-submenu="style" style="display:${display};">
      <div class="glass-card style-submenu-container">
        ${rows.map(r => createSettingsItem(r.label, r.desc, r.key, r.value)).join('')}
        ${createSettingsToggleWithSelectSubmenu(
          tr(t, 'zenStyleSideVideosColumnsLabel'),
          tr(t, 'zenStyleSideVideosColumnsDesc'),
          'zenStyles.sideVideosColumnsEnabled',
          sideVideosColumnsEnabled,
          'style-side-videos',
          tr(t, 'zenStyleSideVideosColumnsLabel'),
          tr(t, 'zenStyleSideVideosColumnsDesc'),
          'zenStyles.sideVideosColumns',
          sideVideosColumnsValue,
          [
            { value: 0, label: 'Default (Off)' },
            { value: 1, label: '1 Column' },
            { value: 2, label: '2 Columns' },
          ]
        )}
      </div>
    </div>
  `;
  }

  /**
   * Creates the speed control submenu (hotkey customization)
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createSpeedControlSubmenu(settings, t) {
    const display = settings.enableSpeedControl ? 'block' : 'none';
    const decrease = (settings.speedControlHotkeys?.decrease || 'g').slice(0, 1).toLowerCase();
    const increase = (settings.speedControlHotkeys?.increase || 'h').slice(0, 1).toLowerCase();
    const reset = (settings.speedControlHotkeys?.reset || 'b').slice(0, 1).toLowerCase();

    return `
    <div class="speed-submenu" data-submenu="speed" style="display:${display};">
      <div class="glass-card speed-submenu-container">
        <div class="ytp-plus-settings-item speed-hotkeys-row">
          <div class="speed-hotkeys-info">
            <div class="ytp-plus-settings-item-label">${tr(t, 'speedHotkeysTitle')}</div>
            <div class="ytp-plus-settings-item-description">${tr(t, 'speedHotkeysDesc')}</div>
            <div class="speed-hotkeys-fields">
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="decrease"
                  value="${escapeHTML(decrease)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'decreaseSpeedHotkey')}</span>
              </label>
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="increase"
                  value="${escapeHTML(increase)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'increaseSpeedHotkey')}</span>
              </label>
              <label class="speed-hotkey-field">
                <input
                  type="text"
                  class="speed-hotkey-input"
                  data-speed-hotkey="reset"
                  value="${escapeHTML(reset)}"
                  maxlength="1"
                  autocomplete="off"
                  spellcheck="false"
                >
                <span>${tr(t, 'resetButton')}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the loop control submenu (hotkey customization for A → B)
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string}
   */
  function createLoopSubmenu(settings, t) {
    const display = settings.enableLoop ? 'block' : 'none';
    const setPointA = (settings.loopHotkeys?.setPointA || 'k').slice(0, 1).toLowerCase();
    const setPointB = (settings.loopHotkeys?.setPointB || 'l').slice(0, 1).toLowerCase();
    const resetPoints = (settings.loopHotkeys?.resetPoints || 'o').slice(0, 1).toLowerCase();

    return `
    <div class="loop-submenu loop-submenu-compact" data-submenu="loop" style="display:${display};">
      <div class="ytp-plus-settings-item loop-hotkeys-row loop-hotkeys-row-no-margin">
        <div class="loop-hotkeys-info">
          <div class="ytp-plus-settings-item-label">${tr(t, 'loopSegmentTitle')}</div>
          <div class="ytp-plus-settings-item-description">${tr(t, 'loopSegmentDesc')}</div>
          <div class="loop-hotkeys-fields">
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointA"
                value="${escapeHTML(setPointA)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointAHotkey')}</span>
            </label>
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="setPointB"
                value="${escapeHTML(setPointB)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'setPointBHotkey')}</span>
            </label>
            <label class="loop-hotkey-field">
              <input
                type="text"
                class="loop-hotkey-input"
                data-loop-hotkey="resetPoints"
                value="${escapeHTML(resetPoints)}"
                maxlength="1"
                autocomplete="off"
                spellcheck="false"
              >
              <span>${tr(t, 'resetButton')}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  }

  /**
   * Creates the basic settings section
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Basic section HTML
   */
  function createBasicSettingsSection(settings, t) {
    const downloadEnabled = !!settings.enableDownload;
    const styleEnabled = settings.enableZenStyles !== false;
    const speedEnabled = !!settings.enableSpeedControl;
    return `
    <div class="ytp-plus-settings-section" data-section="basic">
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableZenStyles">${tr(
            t,
            'zenStylesTitle'
          )}</label>
          <div class="ytp-plus-settings-item-description">${tr(t, 'zenStylesDesc')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="style"
            aria-label="Toggle styles submenu"
            aria-expanded="${styleEnabled ? 'true' : 'false'}"
            ${styleEnabled ? '' : 'disabled'}
            style="display:${styleEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableZenStyles" class="ytp-plus-settings-checkbox" data-setting="enableZenStyles" ${
            styleEnabled ? 'checked' : ''
          }>
        </div>
      </div>
      ${createStyleSubmenu(settings, t)}
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableSpeedControl">${t(
            'speedControl'
          )}</label>
          <div class="ytp-plus-settings-item-description">${t('speedControlDesc')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="speed"
            aria-label="Toggle speed submenu"
            aria-expanded="${speedEnabled ? 'true' : 'false'}"
            ${speedEnabled ? '' : 'disabled'}
            style="display:${speedEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableSpeedControl" class="ytp-plus-settings-checkbox" data-setting="enableSpeedControl" ${
            speedEnabled ? 'checked' : ''
          }>
        </div>
      </div>
      ${createSpeedControlSubmenu(settings, t)}
      ${createSettingsItem(t('screenshotButton'), t('screenshotButtonDesc'), 'enableScreenshot', settings.enableScreenshot)}
      <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="ytp-plus-setting-enableDownload">${t(
            'downloadButton'
          )}</label>
          <div class="ytp-plus-settings-item-description">${t('downloadButtonDesc')}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle"
            data-submenu="download"
            aria-label="Toggle download submenu"
            aria-expanded="${downloadEnabled ? 'true' : 'false'}"
            ${downloadEnabled ? '' : 'disabled'}
            style="display:${downloadEnabled ? 'inline-flex' : 'none'};"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="ytp-plus-setting-enableDownload" class="ytp-plus-settings-checkbox" data-setting="enableDownload" ${
            settings.enableDownload ? 'checked' : ''
          }>
        </div>
      </div>
      ${createDownloadSubmenu(settings, t)}
      ${createSettingsItem(
        t('adBlocker'),
        t('adBlockerDescription'),
        'enableAdBlocker',
        readLegacyModuleSetting('youtube_adblocker_settings', true)
      )}
    </div>
  `;
  }

  /**
   * Creates the about section with logo
   * @param {Function} t
   * @returns {string} About section HTML
   */
  function createAboutSection(t) {
    return `
    <div class="ytp-plus-settings-section hidden" data-section="about">
      <div class="about-section-content">
        <svg class="app-icon" width="90" height="90" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1">
          <path d="m23.24,4.62c-0.85,0.45 -2.19,2.12 -4.12,5.13c-1.54,2.41 -2.71,4.49 -3.81,6.8c-0.55,1.14 -1.05,2.2 -1.13,2.35c-0.08,0.16 -0.78,0.7 -1.66,1.28c-1.38,0.91 -1.8,1.29 -1.4,1.28c0.08,0 0.67,-0.35 1.31,-0.77c0.64,-0.42 1.19,-0.76 1.2,-0.74c0.02,0.02 -0.1,0.31 -0.25,0.66c-1.03,2.25 -1.84,5.05 -1.84,6.37c0.01,1.89 0.84,2.67 2.86,2.67c1.08,0 1.94,-0.31 3.66,-1.29c1.84,-1.06 3.03,-1.93 4.18,-3.09c1.69,-1.7 2.91,-3.4 3.28,-4.59c0.59,-1.9 -0.1,-3.08 -2.02,-3.44c-0.87,-0.16 -2.85,-0.14 -3.75,0.06c-1.78,0.38 -2.74,0.76 -2.5,1c0.03,0.03 0.5,-0.1 1.05,-0.28c1.49,-0.48 2.34,-0.59 3.88,-0.53c1.64,0.07 2.09,0.19 2.69,0.75l0.46,0.43l0,0.87c0,0.74 -0.05,0.98 -0.35,1.6c-0.69,1.45 -2.69,3.81 -4.37,5.14c-0.93,0.74 -2.88,1.94 -4.07,2.5c-1.64,0.77 -3.56,0.72 -4.21,-0.11c-0.39,-0.5 -0.5,-1.02 -0.44,-2.11c0.05,-0.85 0.16,-1.32 0.67,-2.86c0.34,-1.01 0.86,-2.38 1.15,-3.04c0.52,-1.18 0.55,-1.22 1.6,-2.14c4.19,-3.65 8.42,-9.4 9.02,-12.26c0.2,-0.94 0.13,-1.46 -0.21,-1.7c-0.31,-0.22 -0.38,-0.21 -0.89,0.06m0.19,0.26c-0.92,0.41 -3.15,3.44 -5.59,7.6c-1.05,1.79 -3.12,5.85 -3.02,5.95c0.07,0.07 1.63,-1.33 2.58,-2.34c1.57,-1.65 3.73,-4.39 4.88,-6.17c1.31,-2.03 2.06,-4.11 1.77,-4.89c-0.13,-0.34 -0.16,-0.35 -0.62,-0.15m11.69,13.32c-0.3,0.6 -1.19,2.54 -1.98,4.32c-1.6,3.62 -1.67,3.71 -2.99,4.34c-1.13,0.54 -2.31,0.85 -3.54,0.92c-0.99,0.06 -1.08,0.04 -1.38,-0.19c-0.28,-0.22 -0.31,-0.31 -0.26,-0.7c0.03,-0.25 0.64,-1.63 1.35,-3.08c1.16,-2.36 2.52,-5.61 2.52,-6.01c0,-0.49 -0.36,0.19 -1.17,2.22c-0.51,1.26 -1.37,3.16 -1.93,4.24c-0.55,1.08 -1.04,2.17 -1.09,2.43c-0.1,0.59 0.07,1.03 0.49,1.28c0.78,0.46 3.3,0.06 5.13,-0.81l0.93,-0.45l-0.66,1.25c-0.7,1.33 -3.36,6.07 -4.31,7.67c-2.02,3.41 -3.96,5.32 -6.33,6.21c-2.57,0.96 -4.92,0.74 -6.14,-0.58c-0.81,-0.88 -0.82,-1.71 -0.04,-3.22c1.22,-2.36 6.52,-6.15 10.48,-7.49c0.52,-0.18 0.95,-0.39 0.95,-0.46c0,-0.21 -0.19,-0.18 -1.24,0.2c-1.19,0.43 -3.12,1.37 -4.34,2.11c-2.61,1.59 -5.44,4.09 -6.13,5.43c-1.15,2.2 -0.73,3.61 1.4,4.6c0.59,0.28 0.75,0.3 2.04,0.3c1.67,0 2.42,-0.18 3.88,-0.89c1.87,-0.92 3.17,-2.13 4.72,-4.41c0.98,-1.44 4.66,-7.88 5.91,-10.33c0.25,-0.49 0.68,-1.19 0.96,-1.56c0.28,-0.37 0.76,-1.15 1.06,-1.73c0.82,-1.59 2.58,-6.10 2.58,-6.6c0,-0.06 -0.07,-0.1 -0.17,-0.1c-0.10,0 -0.39,0.44 -0.71,1.09m-1.34,3.7c-0.93,2.08 -1.09,2.48 -0.87,2.2c0.19,-0.24 1.66,-3.65 1.6,-3.71c-0.02,-0.02 -0.35,0.66 -0.73,1.51" fill="none" fill-rule="evenodd" stroke="currentColor" />
        </svg>
        <h1>YouTube +</h1>
      </div>
      <div class="ytp-plus-about-actions">
        <button class="glass-button" id="open-ytp-github" type="button">${t('openGitHubButton')}</button>
                <button class="glass-button" id="open-ytp-discussions" type="button">${t('openDiscussionsButton')}</button>
                <button class="glass-button" id="open-ytp-greasyfork" type="button">${t('openGreasyForkButton')}</button>
      </div>
      <div class="ytp-plus-about-footer">
        <div>Made with ❤️ by <a href="https://github.com/diorhc" target="_blank" rel="noopener noreferrer" class="ytp-plus-about-author-link">diorhc</a></div>
        <div>License: MIT</div>
      </div>
    </div>
  `;
  }

  /**
   * Gets YouTube Music settings for the modal HTML render path.
   *
   * Compatibility shim: the public `YouTubePlusSettingsStore`
   * owns persistence now. This function delegates to the store
   * so that the modal HTML continues to read the same merged
   * shape that `SettingsStore.getMusicSettings()` returns, with
   * no behavioral change for existing callers.
   *
   * Falls back to a defaults-only object if the store is not yet
   * ready, throws, or localStorage is unavailable (e.g. when the
   * page context is sandboxed). This keeps `createMainContent`
   * robust: a single broken accessor must not blank out every
   * section of the settings modal.
   * @returns {{ enableMusic: boolean; immersiveSearchStyles: boolean; hoverStyles: boolean; playerSidebarStyles: boolean; playerBarStyles: boolean; centeredPlayerStyles: boolean; centeredPlayerBarStyles: boolean; miniPlayerStyles: boolean; scrollToTopStyles: boolean; }} YouTube Music settings
   */
  function getMusicSettingsCompat() {
    try {
      return /** @type {any} */ (SettingsStore.getMusicSettings());
    } catch (_e) {
      // SettingsStore is missing or threw (e.g. localStorage blocked,
      // module init order issue, partial load). Return a defaults-only
      // object so the modal still renders every section.
      return { ...MUSIC_DEFAULTS };
    }
  }

  /**
   * Creates the advanced settings section.
   * Note: other modules may append additional items to this section.
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Advanced section HTML
   */
  function createAdvancedSettingsSection(settings, t) {
    const musicSettings = getMusicSettingsCompat();
    const musicEnabled = !!musicSettings.enableMusic;
    const enhancedEnabled = settings.enableEnhanced !== false;

    // Enhanced features settings with defaults
    const enhancedSettings = {
      enableTabview: settings.enableTabview !== false,
      enableCommentTranslate: settings.enableCommentTranslate !== false,
      enablePlayAll: settings.enablePlayAll !== false,
      enableResumeTime: settings.enableResumeTime !== false,
      enableZoom: settings.enableZoom !== false,
      enableThumbnail: settings.enableThumbnail !== false,
      enablePlaylistSearch: settings.enablePlaylistSearch !== false,
      enableScrollToTopButton: settings.enableScrollToTopButton !== false,
      enableRememberManualQuality: settings.enableRememberManualQuality !== false,
    };

    return `
    <div class="ytp-plus-settings-section hidden" data-section="advanced">
      <div class="ytp-plus-settings-group">
        <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
          <div>
            <label class="ytp-plus-settings-item-label">${tr(t, 'enhancedFeaturesTitle')}</label>
            <div class="ytp-plus-settings-item-description">${tr(t, 'enhancedFeaturesDesc')}</div>
          </div>
          <div class="ytp-plus-settings-item-actions">
            <button
              type="button"
              class="ytp-plus-submenu-toggle"
              data-submenu="enhanced"
              aria-label="Toggle enhanced features submenu"
              aria-expanded="${enhancedEnabled ? 'true' : 'false'}"
              ${enhancedEnabled ? '' : 'disabled'}
              style="display:${enhancedEnabled ? 'inline-flex' : 'none'};"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableEnhanced" ${
              enhancedEnabled ? 'checked' : ''
            }>
          </div>
        </div>

        <div class="enhanced-submenu" data-submenu="enhanced" style="display:${
          enhancedEnabled ? 'block' : 'none'
        };">
          <div class="glass-card ytp-plus-settings-submenu-card">
            <div class="endscreen-settings-slot"></div>
            ${createSettingsItem(
              tr(t, 'enableTabviewLabel'),
              tr(t, 'enableTabviewDesc'),
              'enableTabview',
              enhancedSettings.enableTabview
            )}
            ${createSettingsItem(
              tr(t, 'enableCommentTranslateLabel'),
              tr(t, 'enableCommentTranslateDesc'),
              'enableCommentTranslate',
              enhancedSettings.enableCommentTranslate
            )}
            ${createSettingsItem(
              tr(t, 'enablePlayAllLabel'),
              tr(t, 'enablePlayAllDesc'),
              'enablePlayAll',
              enhancedSettings.enablePlayAll
            )}
            ${createSettingsItem(
              tr(t, 'enableResumeTimeLabel'),
              tr(t, 'enableResumeTimeDesc'),
              'enableResumeTime',
              enhancedSettings.enableResumeTime
            )}
            ${createSettingsItem(
              tr(t, 'enableZoomLabel'),
              tr(t, 'enableZoomDesc'),
              'enableZoom',
              enhancedSettings.enableZoom
            )}
            ${createSettingsItem(
              tr(t, 'thumbnailPreview'),
              tr(t, 'thumbnailPreviewDesc'),
              'enableThumbnail',
              enhancedSettings.enableThumbnail
            )}
            ${createSettingsItem(
              tr(t, 'enablePlaylistSearchLabel'),
              tr(t, 'enablePlaylistSearchDesc'),
              'enablePlaylistSearch',
              enhancedSettings.enablePlaylistSearch
            )}
            ${createSettingsItem(
              tr(t, 'scrollToTopButtonLabel'),
              tr(t, 'scrollToTopButtonDesc'),
              'enableScrollToTopButton',
              enhancedSettings.enableScrollToTopButton
            )}
            ${createSettingsItem(
              tr(t, 'rememberManualQualityLabel'),
              tr(t, 'rememberManualQualityDesc'),
              'enableRememberManualQuality',
              enhancedSettings.enableRememberManualQuality
            )}
            <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu ytp-plus-settings-item--top-gap">
              <div>
                <label class="ytp-plus-settings-item-label">${tr(t, 'enableLoopLabel')}</label>
                <div class="ytp-plus-settings-item-description">${tr(t, 'enableLoopDesc')}</div>
              </div>
              <div class="ytp-plus-settings-item-actions">
                <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableLoop" ${
                  settings.enableLoop ? 'checked' : ''
                }>
              </div>
            </div>
            ${createLoopSubmenu(settings, t)}
          </div>
        </div>

        <div class="ytp-plus-settings-item ytp-plus-settings-item--with-submenu">
          <div>
            <label class="ytp-plus-settings-item-label">${t('youtubeMusicTitle')}</label>
            <div class="ytp-plus-settings-item-description">${t('youtubeMusicDesc')}</div>
          </div>
          <div class="ytp-plus-settings-item-actions">
            <button
              type="button"
              class="ytp-plus-submenu-toggle"
              data-submenu="music"
              aria-label="Toggle YouTube Music submenu"
              aria-expanded="${musicEnabled ? 'true' : 'false'}"
              ${musicEnabled ? '' : 'disabled'}
              style="display:${musicEnabled ? 'inline-flex' : 'none'};"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enableMusic" ${
              musicSettings.enableMusic ? 'checked' : ''
            }>
          </div>
        </div>

        <div class="music-submenu" data-submenu="music" style="display:${
          musicEnabled ? 'block' : 'none'
        };">
          <div class="glass-card ytp-plus-settings-submenu-card">
            ${createSettingsItem(
              t('immersiveSearchLabel'),
              t('immersiveSearchDesc'),
              'immersiveSearchStyles',
              musicSettings.immersiveSearchStyles
            )}
            ${createSettingsItem(
              t('sidebarHoverLabel'),
              t('sidebarHoverDesc'),
              'hoverStyles',
              musicSettings.hoverStyles
            )}
            ${createSettingsItem(
              t('playerSidebarStylesLabel'),
              t('playerSidebarStylesDesc'),
              'playerSidebarStyles',
              musicSettings.playerSidebarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerLabel'),
              t('centeredPlayerDesc'),
              'centeredPlayerStyles',
              musicSettings.centeredPlayerStyles
            )}
            ${createSettingsItem(
              t('playerBarStylesLabel'),
              t('playerBarStylesDesc'),
              'playerBarStyles',
              musicSettings.playerBarStyles
            )}
            ${createSettingsItem(
              t('centeredPlayerBarStylesLabel'),
              t('centeredPlayerBarStylesDesc'),
              'centeredPlayerBarStyles',
              musicSettings.centeredPlayerBarStyles
            )}
            ${createSettingsItem(
              t('miniPlayerStylesLabel'),
              t('miniPlayerStylesDesc'),
              'miniPlayerStyles',
              musicSettings.miniPlayerStyles
            )}
          </div>
        </div>

        ${buildPipSettingsHTML(settings, t)}

        ${buildTimecodeSettingsHTML(settings, t)}
      </div>
    </div>
  `;
  }

  /**
   * Build PiP settings HTML for the Advanced section.
   * @param {Record<string, any>} _settings
   * @param {Function} t
   * @returns {string}
   */
  function buildPipSettingsHTML(_settings, t) {
    const pipEnabled = readLegacyModuleSetting('youtube_pip_settings', true);
    const pipShortcut = readLegacyShortcutSetting('youtube_pip_settings', {
      key: 'P',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
    });
    const storedExpanded = readSubmenuExpanded('pip');
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;
    const submenuVisible = pipEnabled && initialExpanded;

    return `
      <div class="ytp-plus-settings-item pip-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="pip-enable-checkbox">${escapeHTML(t('pipTitle'))}</label>
          <div class="ytp-plus-settings-item-description">${escapeHTML(t('pipDescription'))}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle${pipEnabled ? '' : ' pip-submenu-toggle-hidden'}"
            data-submenu="pip"
            aria-label="${escapeHTML(t('togglePipSubmenu'))}"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${pipEnabled ? '' : 'disabled'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" class="ytp-plus-settings-checkbox" data-setting="enablePiP" id="pip-enable-checkbox" ${pipEnabled ? 'checked' : ''}>
        </div>
      </div>

      <div class="pip-submenu pip-submenu-layout${submenuVisible ? '' : ' is-hidden'}" data-submenu="pip">
        <div class="glass-card pip-submenu-card">
          <div class="ytp-plus-settings-item pip-shortcut-item">
            <div>
              <label class="ytp-plus-settings-item-label">${escapeHTML(t('pipShortcutTitle'))}</label>
              <div class="ytp-plus-settings-item-description">${escapeHTML(t('pipShortcutDescription'))}</div>
            </div>
            <div class="pip-shortcut-editor">
              ${buildShortcutEditorHTML('pip', pipShortcut, t)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Build Timecode settings HTML for the Advanced section.
   * @param {Record<string, any>} _settings
   * @param {Function} t
   * @returns {string}
   */
  function buildTimecodeSettingsHTML(_settings, t) {
    const timecodeEnabled = readLegacyModuleSetting('youtube_timecode_settings', true);
    const timecodeShortcut = readLegacyShortcutSetting('youtube_timecode_settings', {
      key: 'T',
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
    });
    const storedExpanded = readSubmenuExpanded('timecode');
    const initialExpanded = typeof storedExpanded === 'boolean' ? storedExpanded : true;
    const submenuVisible = timecodeEnabled && initialExpanded;

    return `
      <div class="ytp-plus-settings-item timecode-settings-item ytp-plus-settings-item--with-submenu">
        <div>
          <label class="ytp-plus-settings-item-label" for="timecode-enable-checkbox">${escapeHTML(t('enableTimecode'))}</label>
          <div class="ytp-plus-settings-item-description">${escapeHTML(t('enableDescription'))}</div>
        </div>
        <div class="ytp-plus-settings-item-actions">
          <button
            type="button"
            class="ytp-plus-submenu-toggle timecode-submenu-toggle${timecodeEnabled ? '' : ' timecode-submenu-toggle-hidden'}"
            data-submenu="timecode"
            aria-label="Toggle timecode submenu"
            aria-expanded="${initialExpanded ? 'true' : 'false'}"
            ${timecodeEnabled ? '' : 'disabled'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          <input type="checkbox" id="timecode-enable-checkbox" class="ytp-plus-settings-checkbox" data-setting="timecodeEnabled" ${timecodeEnabled ? 'checked' : ''}>
        </div>
      </div>

      <div class="timecode-submenu timecode-submenu-layout${submenuVisible ? '' : ' is-hidden'}" data-submenu="timecode">
        <div class="glass-card timecode-submenu-card">
          <div class="ytp-plus-settings-item timecode-settings-item timecode-shortcut-item timecode-shortcut-row">
            <div>
              <label class="ytp-plus-settings-item-label">${escapeHTML(t('keyboardShortcut'))}</label>
              <div class="ytp-plus-settings-item-description">${escapeHTML(t('shortcutDescription'))}</div>
            </div>
            <div class="timecode-shortcut-editor">
              ${buildShortcutEditorHTML('timecode', timecodeShortcut, t)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Creates the experimental settings section with YouTube Music options
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Experimental section HTML
   */
  function createExperimentalSettingsSection(settings, t) {
    const themeVariant = settings?.zenStyles?.themeVariant === 'solid' ? 'solid' : 'glass';

    return `
    <div class="ytp-plus-settings-section hidden" data-section="experimental">
        <div class="ytp-plus-settings-item ytp-plus-theme-item">
          <div>
            <label class="ytp-plus-settings-item-label">${tr(t, 'zenStyleThemeVariantLabel')}</label>
            <div class="ytp-plus-settings-item-description">${tr(t, 'zenStyleThemeVariantDesc')}</div>
          </div>
          <div class="ytp-plus-theme-grid" role="radiogroup" aria-label="${tr(t, 'zenStyleThemeVariantLabel')}">
            <button
              type="button"
              class="ytp-plus-theme-card ${themeVariant === 'glass' ? 'active' : ''}"
              role="radio"
              aria-checked="${themeVariant === 'glass' ? 'true' : 'false'}"
              data-setting-card="zenStyles.themeVariant"
              data-value="glass"
            >
              <span class="ytp-plus-theme-card-title">${tr(t, 'themeVariantGlass')}</span>
            </button>
            <button
              type="button"
              class="ytp-plus-theme-card ${themeVariant === 'solid' ? 'active' : ''}"
              role="radio"
              aria-checked="${themeVariant === 'solid' ? 'true' : 'false'}"
              data-setting-card="zenStyles.themeVariant"
              data-value="solid"
            >
              <span class="ytp-plus-theme-card-title">${tr(t, 'themeVariantSolid')}</span>
            </button>
          </div>
        </div>
        ${createSettingsItem(
          t('statisticsButton'),
          t('statisticsButtonDescription'),
          'enableStatsButton',
          readLegacyModuleSetting('youtube_stats_button_enabled', true)
        )}
        ${createSettingsItem(
          t('channelStatsTitle'),
          t('channelStatsDescription'),
          'enableChannelStats',
          readLegacyModuleSetting('youtube_channel_stats_settings', true)
        )}
        <div class="ytp-plus-settings-item comment-manager-settings-item">
          <div>
            <label class="ytp-plus-settings-item-label">${t('commentManagement')}</label>
            <div class="ytp-plus-settings-item-description">${t('bulkDeleteDescription')}</div>
          </div>
          <button class="ytp-plus-button update-open-page-btn comment-manager-settings-open-button" id="open-comment-history-page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15,3 21,3 21,9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </button>
        </div>
    </div>
  `;
  }

  /**
   * Creates the voting section
   * @param {Record<string, any>} _settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Voting section HTML
   */
  function createVotingSection(_settings, t) {
    const previewBefore = tr(t, 'votingPreviewBefore');
    const previewAfter = tr(t, 'votingPreviewAfter');

    return `
    <div class="ytp-plus-settings-section hidden" data-section="voting">
      <div class="ytp-plus-settings-voting-header">
        <h3>${tr(t, 'votingTitle')}</h3>
        <p class="ytp-plus-settings-voting-desc">${tr(t, 'votingDesc')}</p>
      </div>

      <div class="ytp-plus-voting-preview">
        <div class="ytp-plus-ba-container">
          <div class="ytp-plus-ba-before">
            <img src="https://i.imgur.com/FVW4tdH.jpeg" alt="${previewBefore}" draggable="false" />
            <span class="ytp-plus-ba-label ytp-plus-ba-label-before">${previewBefore}</span>
          </div>
          <div class="ytp-plus-ba-after">
            <img src="https://i.imgur.com/ljq1KeL.jpeg" alt="${previewAfter}" draggable="false" />
            <span class="ytp-plus-ba-label ytp-plus-ba-label-after">${previewAfter}</span>
          </div>
          <div class="ytp-plus-ba-divider" role="separator" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
        </div>

        <div class="ytp-plus-vote-bar-section" id="ytp-plus-vote-bar-section">
          <div class="ytp-plus-vote-bar-buttons">
            <div class="ytp-plus-vote-bar-track" id="ytp-plus-vote-bar-fill"></div>
            <button class="ytp-plus-vote-bar-btn" id="ytp-plus-vote-bar-up" type="button" aria-label="${tr(t, 'like')}" data-vote="1">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 12.1852L20.2361 12.0574L20.9751 12.1852ZM20.2696 16.265L19.5306 16.1371L20.2696 16.265ZM6.93776 20.4771L6.19055 20.5417H6.19055L6.93776 20.4771ZM6.1256 11.0844L6.87281 11.0198L6.1256 11.0844ZM13.9949 5.22142L14.7351 5.34269V5.34269L13.9949 5.22142ZM13.3323 9.26598L14.0724 9.38725V9.38725L13.3323 9.26598ZM6.69813 9.67749L6.20854 9.10933H6.20854L6.69813 9.67749ZM8.13687 8.43769L8.62646 9.00585H8.62646L8.13687 8.43769ZM10.518 4.78374L9.79207 4.59542L10.518 4.78374ZM10.9938 2.94989L11.7197 3.13821L11.7197 3.13821L10.9938 2.94989ZM12.6676 2.06435L12.4382 2.77841L12.4382 2.77841L12.6676 2.06435ZM12.8126 2.11093L13.0419 1.39687L13.0419 1.39687L12.8126 2.11093ZM9.86194 6.46262L10.5235 6.81599V6.81599L9.86194 6.46262ZM13.9047 3.24752L13.1787 3.43584V3.43584L13.9047 3.24752ZM11.6742 2.13239L11.3486 1.45675L11.3486 1.45675L11.6742 2.13239ZM20.2361 12.0574L19.5306 16.1371L21.0086 16.3928L21.7142 12.313L20.2361 12.0574ZM13.245 21.25H8.59634V22.75H13.245V21.25ZM7.68497 20.4125L6.87281 11.0198L5.37839 11.149L6.19055 20.5417L7.68497 20.4125ZM19.5306 16.1371C19.0238 19.0677 16.3813 21.25 13.245 21.25V22.75C17.0712 22.75 20.3708 20.081 21.0086 16.3928L19.5306 16.1371ZM13.2548 5.10015L12.5921 9.14472L14.0724 9.38725L14.7351 5.34269L13.2548 5.10015ZM7.18772 10.2456L8.62646 9.00585L7.64728 7.86954L6.20854 9.10933L7.18772 10.2456ZM11.244 4.97206L11.7197 3.13821L10.2678 2.76157L9.79207 4.59542L11.244 4.97206ZM12.4382 2.77841L12.5832 2.82498L13.0419 1.39687L12.897 1.3503L12.4382 2.77841ZM10.5235 6.81599C10.8354 6.23198 11.0777 5.61339 11.244 4.97206L9.79207 4.59542C9.65572 5.12107 9.45698 5.62893 9.20041 6.10924L10.5235 6.81599ZM12.5832 2.82498C12.8896 2.92342 13.1072 3.16009 13.1787 3.43584L14.6306 3.05921C14.4252 2.26719 13.819 1.64648 13.0419 1.39687L12.5832 2.82498ZM11.7197 3.13821C11.7547 3.0032 11.8522 2.87913 11.9998 2.80804L11.3486 1.45675C10.8166 1.71309 10.417 2.18627 10.2678 2.76157L11.7197 3.13821ZM11.9998 2.80804C12.1345 2.74311 12.2931 2.73181 12.4382 2.77841L12.897 1.3503C12.3872 1.18655 11.8312 1.2242 11.3486 1.45675L11.9998 2.80804ZM14.1537 10.9842H19.3348V9.4842H14.1537V10.9842ZM14.7351 5.34269C14.8596 4.58256 14.824 3.80477 14.6306 3.0592L13.1787 3.43584C13.3197 3.97923 13.3456 4.54613 13.2548 5.10016L14.7351 5.34269ZM8.59634 21.25C8.12243 21.25 7.726 20.887 7.68497 20.4125L6.19055 20.5417C6.29851 21.7902 7.34269 22.75 8.59634 22.75V21.25ZM8.62646 9.00585C9.30632 8.42 10.0391 7.72267 10.5235 6.81599L9.20041 6.10924C8.85403 6.75767 8.30249 7.30493 7.64728 7.86954L8.62646 9.00585ZM21.7142 12.313C21.9695 10.8365 20.8341 9.4842 19.3348 9.4842V10.9842C19.9014 10.9842 20.3332 11.4959 20.2361 12.0574L21.7142 12.313ZM12.5921 9.14471C12.4344 10.1076 13.1766 10.9842 14.1537 10.9842V9.4842C14.1038 9.4842 14.0639 9.43901 14.0724 9.38725L12.5921 9.14471ZM6.87281 11.0198C6.84739 10.7258 6.96474 10.4378 7.18772 10.2456L6.20854 9.10933C5.62021 9.61631 5.31148 10.3753 5.37839 11.149L6.87281 11.0198Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 21.4709L3.22439 21.5355L3.9716 21.4709ZM3 10.2344L3.74721 10.1698C3.71261 9.76962 3.36893 9.46776 2.96767 9.48507C2.5664 9.50239 2.25 9.83274 2.25 10.2344L3 10.2344ZM4.71881 21.4063L3.74721 10.1698L2.25279 10.299L3.22439 21.5355L4.71881 21.4063ZM3.75 21.5129V10.2344H2.25V21.5129H3.75ZM3.22439 21.5355C3.2112 21.383 3.33146 21.2502 3.48671 21.2502V22.7502C4.21268 22.7502 4.78122 22.1281 4.71881 21.4063L3.22439 21.5355ZM3.48671 21.2502C3.63292 21.2502 3.75 21.3686 3.75 21.5129H2.25C2.25 22.1954 2.80289 22.7502 3.48671 22.7502V21.2502Z" fill="currentColor"></path> </svg>
            </button>
            <button class="ytp-plus-vote-bar-btn" id="ytp-plus-vote-bar-down" type="button" aria-label="${tr(t, 'dislike')}" data-vote="-1">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M20.9751 11.8148L20.2361 11.9426L20.9751 11.8148ZM20.2696 7.73505L19.5306 7.86285L20.2696 7.73505ZM6.93776 3.52293L6.19055 3.45832H6.19055L6.93776 3.52293ZM6.1256 12.9156L6.87281 12.9802L6.1256 12.9156ZM13.9949 18.7786L14.7351 18.6573V18.6573L13.9949 18.7786ZM13.3323 14.734L14.0724 14.6128V14.6128L13.3323 14.734ZM6.69813 14.3225L6.20854 14.8907H6.20854L6.69813 14.3225ZM8.13687 15.5623L8.62646 14.9942H8.62646L8.13687 15.5623ZM10.518 19.2163L9.79207 19.4046L10.518 19.2163ZM10.9938 21.0501L11.7197 20.8618L11.7197 20.8618L10.9938 21.0501ZM12.6676 21.9356L12.4382 21.2216L12.4382 21.2216L12.6676 21.9356ZM12.8126 21.8891L13.0419 22.6031L13.0419 22.6031L12.8126 21.8891ZM9.86194 17.5374L10.5235 17.184V17.184L9.86194 17.5374ZM13.9047 20.7525L13.1787 20.5642V20.5642L13.9047 20.7525ZM11.6742 21.8676L11.3486 22.5433L11.3486 22.5433L11.6742 21.8676ZM20.2361 11.9426L19.5306 7.86285L21.0086 7.60724L21.7142 11.687L20.2361 11.9426ZM13.245 2.75H8.59634V1.25H13.245V2.75ZM7.68497 3.58754L6.87281 12.9802L5.37839 12.851L6.19055 3.45832L7.68497 3.58754ZM19.5306 7.86285C19.0238 4.93226 16.3813 2.75 13.245 2.75V1.25C17.0712 1.25 20.3708 3.91895 21.0086 7.60724L19.5306 7.86285ZM13.2548 18.8998L12.5921 14.8553L14.0724 14.6128L14.7351 18.6573L13.2548 18.8998ZM7.18772 13.7544L8.62646 14.9942L7.64728 16.1305L6.20854 14.8907L7.18772 13.7544ZM11.244 19.0279L11.7197 20.8618L10.2678 21.2384L9.79207 19.4046L11.244 19.0279ZM12.4382 21.2216L12.5832 21.175L13.0419 22.6031L12.897 22.6497L12.4382 21.2216ZM10.5235 17.184C10.8354 17.768 11.0777 18.3866 11.244 19.0279L9.79207 19.4046C9.65572 18.8789 9.45698 18.3711 9.20041 17.8908L10.5235 17.184ZM12.5832 21.175C12.8896 21.0766 13.1072 20.8399 13.1787 20.5642L14.6306 20.9408C14.4252 21.7328 13.819 22.3535 13.0419 22.6031L12.5832 21.175ZM11.7197 20.8618C11.7547 20.9968 11.8522 21.1209 11.9998 21.192L11.3486 22.5433C10.8166 22.2869 10.417 21.8137 10.2678 21.2384L11.7197 20.8618ZM11.9998 21.192C12.1345 21.2569 12.2931 21.2682 12.4382 21.2216L12.897 22.6497C12.3872 22.8135 11.8312 22.7758 11.3486 22.5433L11.9998 21.192ZM14.1537 13.0158H19.3348V14.5158H14.1537V13.0158ZM14.7351 18.6573C14.8596 19.4174 14.824 20.1952 14.6306 20.9408L13.1787 20.5642C13.3197 20.0208 13.3456 19.4539 13.2548 18.8998L14.7351 18.6573ZM8.59634 2.75C8.12243 2.75 7.726 3.11302 7.68497 3.58754L6.19055 3.45832C6.29851 2.20975 7.34269 1.25 8.59634 1.25V2.75ZM8.62646 14.9942C9.30632 15.58 10.0391 16.2773 10.5235 17.184L9.20041 17.8908C8.85403 17.2423 8.30249 16.6951 7.64728 16.1305L8.62646 14.9942ZM21.7142 11.687C21.9695 13.1635 20.8341 14.5158 19.3348 14.5158V13.0158C19.9014 13.0158 20.3332 12.5041 20.2361 11.9426L21.7142 11.687ZM12.5921 14.8553C12.4344 13.8924 13.1766 13.0158 14.1537 13.0158V14.5158C14.1038 14.5158 14.0639 14.561 14.0724 14.6128L12.5921 14.8553ZM6.87281 12.9802C6.84739 13.2742 6.96474 13.5622 7.18772 13.7544L6.20854 14.8907C5.62021 14.3837 5.31148 13.6247 5.37839 12.851L6.87281 12.9802Z" fill="currentColor"></path> <path opacity="0.5" d="M3.9716 2.52911L3.22439 2.4645L3.9716 2.52911ZM3 13.7656L3.74721 13.8302C3.71261 14.2304 3.36893 14.5322 2.96767 14.5149C2.5664 14.4976 2.25 14.1673 2.25 13.7656L3 13.7656ZM4.71881 2.59372L3.74721 13.8302L2.25279 13.701L3.22439 2.4645L4.71881 2.59372ZM3.75 2.48709V13.7656H2.25V2.48709H3.75ZM3.22439 2.4645C3.2112 2.61704 3.33146 2.74983 3.48671 2.74983V1.24983C4.21268 1.24983 4.78122 1.87192 4.71881 2.59372L3.22439 2.4645ZM3.48671 2.74983C3.63292 2.74983 3.75 2.63139 3.75 2.48709H2.25C2.25 1.80457 2.80289 1.24983 3.48671 1.24983V2.74983Z" fill="currentColor"></path> </svg>
            </button>
          </div>
          <div class="ytp-plus-vote-bar-count" id="ytp-plus-vote-bar-count">0</div>
        </div>
      </div>

      <div id="ytp-plus-voting-container"></div>
    </div>
  `;
  }

  /**
   * Creates the main content area
   * @param {Record<string, any>} settings - Settings object
   * @param {Function} t - Translation function
   * @returns {string} Main content HTML
   */
  function createMainContent(settings, t) {
    return `
    <div class="ytp-plus-settings-main">
      <div class="ytp-plus-settings-content">
        ${createBasicSettingsSection(settings, t)}
        ${createAdvancedSettingsSection(settings, t)}
        ${createExperimentalSettingsSection(settings, t)}
        ${createVotingSection(settings, t)}
        <div class="ytp-plus-settings-section hidden" data-section="report"></div>
        ${createAboutSection(t)}
      </div>
    </div>
  `;
  }

  // Export helper functions to window
  if (typeof window !== 'undefined') {
    window.YouTubePlusSettingsHelpers = {
      createSettingsSidebar,
      createMainContent,
      createSettingsItem,
      createSettingsSelect,
      createDownloadSiteOption,
      createBasicSettingsSection,
      createAdvancedSettingsSection,
      createExperimentalSettingsSection,
      createVotingSection,
      readSubmenuExpanded,
      buildShortcutEditorHTML,
      getMusicSettings: getMusicSettingsCompat,
    };
    // Canonical settings store — single source of truth for the
    // settings API. Exposed on both window and unsafeWindow so
    // both page and userscript contexts can reach it.
    window.YouTubePlusSettingsStore = SettingsStore;
    if (typeof unsafeWindow !== 'undefined') {
      unsafeWindow.YouTubePlusSettingsHelpers = window.YouTubePlusSettingsHelpers;
      unsafeWindow.YouTubePlusSettingsStore = window.YouTubePlusSettingsStore;
    }
  }
})();
