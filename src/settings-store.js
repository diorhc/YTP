/**
 * Settings Modal Helpers
 *
 * Settings store plus modal HTML helpers.
 *
 * Responsibility: settings storage and access.
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

/* global GM_getValue, GM_setValue, GM_addValueChangeListener */

(function () {
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    window.YouTubeUtils?.logSuppressed?.(_err, _label || 'SettingsStore');
  // ============================================================
  // SETTINGS STORE
  // ------------------------------------------------------------
  // settings-helpers.js is the single owner of settings state.
  // No other module should call raw storage / GM_getValue /
  // GM_setValue directly for the keys registered in
  // STORAGE_KEYS. Other modules that need to read or write settings
  // should use `window.YouTubePlusSettingsStore` instead. Direct
  // raw storage usage outside this module is treated as legacy
  // and is migrated module-by-module in subsequent refactors.
  // ============================================================

  /** Storage key registry. Stable for backward compatibility. */
  const STORAGE_KEYS = Object.freeze({
    main: 'youtube_plus_settings', // main settings (utils.SETTINGS_KEY)
    all: 'youtube_plus_all_settings_v2', // basic.js SettingsManager v2 legacy
    music: 'youtube-plus-music-settings', // music cross-domain (youtube.com <-> music.youtube.com)
  });

  /**
   * Shared settings blob, shared across youtube subdomains through GM
   * storage. It is the authoritative copy once it exists; localStorage keeps
   * a mirror until 4.0.0 so settings survive a manager without GM storage.
   */
  const GM_BLOB_KEY = 'ytp_settings_v3';

  /** localStorage cache of the theme preference, read at document-start. */
  const THEME_CACHE_KEY = 'ytp-theme-preference';

  /** Envelope version of GM_BLOB_KEY. */
  const BLOB_VERSION = 3;

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
   * @typedef {Object} SpeedHotkeyMap
   * @property {string} decrease
   * @property {string} increase
   * @property {string} reset
   *
   * @typedef {Object} LoopHotkeyMap
   * @property {string} toggleLoop
   * @property {string} setPointA
   * @property {string} setPointB
   * @property {string} resetPoints
   *
   * @typedef {Object} StylesSettings
   * @property {boolean} [thumbnailHover]
   * @property {boolean} [immersiveSearch]
   * @property {boolean} [hideVoiceSearch]
   * @property {boolean} [transparentHeader]
   * @property {boolean} [hideSideGuide]
   * @property {boolean} [cleanSideGuide]
   * @property {boolean} [fixFeedLayout]
   * @property {boolean} [compactFeed]
   * @property {boolean} [betterCaptions]
   * @property {boolean} [playerBlur]
   * @property {boolean} [theaterEnhancements]
   * @property {number} [sideVideosColumns]
   * @property {boolean} [sideVideosColumnsEnabled]
   * @property {'glass' | 'solid' | 'vision' | 'classic' | 'minimal'} [themeVariant]
   * @property {'dark' | 'light' | 'device'} [themePreference]
   *
   * @typedef {Object} YoutubePlusSettings
   * @property {boolean} [enableDownload]
   * @property {boolean} [allowCobaltDiscovery]opt-in for cobalt.directory discovery.
   * @property {boolean} [enableStyles]
   * @property {boolean} [enableSpeedControl]
   * @property {boolean} [enableScreenshot]
   * @property {boolean} [enableEnhanced]
   * @property {boolean} [enableLoop]
   * @property {boolean} [enableTabview]
   * @property {boolean} [enableCommentTranslate]
   * @property {boolean} [enablePlayAll]
   * @property {boolean} [enableResumeTime]
   * @property {boolean} [timecodeEnabled]
   * @property {boolean} [endscreen]
   * @property {boolean} [shortsKeyboard]
   * @property {boolean} [enableZoom]
   * @property {boolean} [enableThumbnail]
   * @property {boolean} [enablePlaylistSearch]
   * @property {boolean} [enableScrollToTopButton]
   * @property {boolean} [enableRememberManualQuality]
   * @property {boolean} [enableStatsButton]
   * @property {boolean} [enableChannelStats]
   * @property {boolean} [performanceMode] Opt-in master switch for the
   *   route-scoped page-cost reductions. Default off.
   * @property {boolean} [performanceModeAmbient]
   * @property {boolean} [performanceModeHoverPreview]
   * @property {boolean} [performanceModeContentVisibility]
   * @property {boolean} [performanceModeLazyChat]
   * @property {boolean} [enableAnimations] Smooth motion for YouTube's own
   *   feed, menus and buttons. Default off.
   * @property {boolean} [enableDebugSurface] Opt-in mirror of the Debug API
   *   onto the page context (unsafeWindow). Default off.
   * @property {boolean} [hideSideGuide]
   * @property {StylesSettings} [styles]
   * @property {SpeedHotkeyMap} [speedControlHotkeys]
   * @property {LoopHotkeyMap} [loopHotkeys]
   * @property {Object} [downloadSites]
   * @property {Object} [downloadSiteCustomization]
   * @property {Object} [music]
   * @property {Record<string, Record<string, unknown>>} [modules] Per-module
   *   settings namespaces (e.g. `modules.music`), stored in the shared blob
   *   beside the main settings.
   *
   * Settings defaults. Backfill missing fields on
   * load() and to provide stable defaults for getFeature().
   */
  const DEFAULTS = /** @type {Readonly<YoutubePlusSettings>} */ (
    Object.freeze({
      enableDownload: true,
      enableStyles: true,
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
      timecodeEnabled: true,
      endscreen: true,
      shortsKeyboard: true,
      // The ad blocker runtime follows this key; the module's own checkbox
      // handler mirrors it into the legacy `youtube_adblocker_settings`.
      enableAdBlocker: true,
      // The PiP runtime follows this key; the checkbox handler mirrors it
      // into the legacy `youtube_pip_settings`.
      enablePip: true,
      // Stats enable flags; stats.js reads these in place of its own storage.
      enableStatsButton: true,
      enableChannelStats: true,
      enableDebugSurface: false,
      hideSideGuide: false,
      // Performance mode: an opt-in, route-scoped set of page-cost reductions.
      // The master switch is off by default; each part can be turned off on its
      // own once the master is on.
      performanceMode: false,
      performanceModeAmbient: true,
      performanceModeHoverPreview: true,
      performanceModeContentVisibility: true,
      performanceModeLazyChat: true,
      enableAnimations: false,
      // Opt-in only: community Cobalt instances discovered via
      // cobalt.directory are contacted only when the user explicitly allows
      // it. By default only the statically verified instances from @connect
      // are used.
      allowCobaltDiscovery: false,
      styles: {
        thumbnailHover: true,
        immersiveSearch: true,
        hideVoiceSearch: true,
        transparentHeader: true,
        hideSideGuide: true,
        cleanSideGuide: false,
        fixFeedLayout: true,
        compactFeed: true,
        betterCaptions: true,
        playerBlur: true,
        theaterEnhancements: true,

        sideVideosColumns: 0,
        sideVideosColumnsEnabled: false,
        themeVariant: 'vision',
        themeStyle: 'glass',
        themePreference: 'device',
      },
      speedControlHotkeys: { decrease: 'g', increase: 'h', reset: 'b' },
      loopHotkeys: {
        toggleLoop: 'r',
        setPointA: 'k',
        setPointB: 'l',
        resetPoints: 'o',
      },
      downloadSites: { externalDownloader: true, ytdl: true, direct: true },
      downloadSiteCustomization: {
        externalDownloader: {
          name: 'SSYouTube',
          url: 'https://ssyoutube.com/watch?v={videoId}',
        },
      },
      music: { ...MUSIC_DEFAULTS },
      // Free-form per-module namespaces live in the shared blob beside the
      // main settings; readers tolerate its absence and writers create it.
      modules: {},
    })
  );

  /**
   * Key registry: every valid top-level settings key.
   * Derived from DEFAULTS at definition time. Used by `hasKey()`
   * to validate paths before get/set and to prevent accidental
   * typos or undocumented key additions from silently persisting.
   * @type {ReadonlySet<string>}
   */
  const KEY_REGISTRY = Object.freeze(new Set(Object.keys(DEFAULTS)));

  /**
   * Per-feature default subsets. Used by getFeature / updateFeature.
   * Typed as `Record<string, unknown>` so featureId can be indexed with an
   * arbitrary string; unknown ids return undefined and the caller
   * falls back to a generic read.
   * @type {Readonly<Record<string, unknown>>}
   */
  const FEATURE_DEFAULTS = Object.freeze({
    music: MUSIC_DEFAULTS,
    download: {
      enableDownload: true,
      downloadSites: { externalDownloader: true, ytdl: true, direct: true },
    },
    styles: DEFAULTS.styles,
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
    /** @type {unknown} */ err
  ) => {
    try {
      storeLogger?.warn?.(label, msg, err);
    } catch (_e) {
      logS(_e);
    }
  };

  /**
   * Read raw value from storage safely.
   * @param {string} key
   * @returns {string|null}
   */
  function readRaw(/** @type {string} */ key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch (e) {
      logS(e);
      safeLogWarn('SettingsStore', 'readRaw failed', e);
      return null;
    }
  }

  /**
   * Write raw value to storage safely.
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
      logS(e);
      safeLogWarn('SettingsStore', 'writeRaw failed', e);
      return false;
    }
  }

  /**
   * Remove a key from storage safely.
   * @param {string} key
   */
  function removeRaw(/** @type {string} */ key) {
    if (typeof localStorage === 'undefined') return false;
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      logS(e);
      safeLogWarn('SettingsStore', 'removeRaw failed', e);
    }
    return false;
  }

  /**
   * Remove every storage key starting with one of the given prefixes.
   * Namespace cleanup lives here so callers never enumerate storage directly.
   * @param {string[]} prefixes
   * @returns {number} number of keys removed
   */
  function clearRaw(/** @type {string[]} */ prefixes) {
    if (typeof localStorage === 'undefined' || !Array.isArray(prefixes)) return 0;
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && prefixes.some(p => key.startsWith(p))) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => removeRaw(k));
      return keysToRemove.length;
    } catch (e) {
      logS(e);
      safeLogWarn('SettingsStore', 'clearRaw failed', e);
      return 0;
    }
  }

  /**
   * Parse JSON safely with a fallback.
   * @param {string|null|undefined} raw
   * @param {unknown} fallback
   * @returns {unknown}
   */
  function safeJSONParse(
    /** @type {string|null|undefined} */ raw,
    /** @type {unknown} */ fallback
  ) {
    if (typeof raw !== 'string' || !raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      logS(_e);
      return fallback;
    }
  }

  /**
   * Get nested value via dot-path, with defensive access.
   * @param {Record<string, unknown>|null|undefined} obj
   * @param {string} path
   * @returns {unknown}
   */
  function getByPath(
    /** @type {Record<string, unknown>|null|undefined} */ obj,
    /** @type {string} */ path
  ) {
    if (!obj || typeof obj !== 'object' || !path) return undefined;
    return path
      .split('.')
      .filter(Boolean)
      .reduce(
        (/** @type {unknown} */ acc, key) =>
          acc && typeof acc === 'object'
            ? /** @type {Record<string, unknown>} */ (acc)[key]
            : undefined,
        /** @type {unknown} */ (obj)
      );
  }

  /**
   * Set nested value via dot-path, creating intermediate objects as needed.
   * Returns true on success.
   * @param {Record<string, unknown>} obj
   * @param {string} path
   * @param {unknown} value
   * @returns {boolean}
   */
  function setByPath(
    /** @type {Record<string, unknown>} */ obj,
    /** @type {string} */ path,
    /** @type {unknown} */ value
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
      cur = /** @type {Record<string, unknown>} */ (cur[k]);
    }
    cur[last] = value;
    return true;
  }

  /**
   * Deep-clone a JSON-safe value.
   * @template T
   * @param {T} value
   * @returns {T}
   */
  function cloneJSON(/** @type {T} */ value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      logS(_e);
      return value;
    }
  }

  // ----- Music compatibility layer -----
  // YouTube Music settings are shared between youtube.com and
  // music.youtube.com. Storage is dual (GM_* + raw storage) for
  // cross-subdomain sync, and the shape includes legacy flag
  // migration. The store exposes a read/write pair that any caller
  // can use. The getMusicSettings() function below is kept for callers
  // that need it; the store's music accessors are a parallel path that
  // new modules can opt into without duplicating logic.

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
    } catch (_e) {
      logS(_e);
    }
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
    } catch (_e) {
      logS(_e);
    }
    return false;
  }

  // ----- Shared settings blob (GM storage) -----
  // One versioned envelope holds the user settings and travels across youtube
  // subdomains. localStorage keeps a mirror; the GM copy is authoritative once
  // it exists. Only the owning origin seeds the blob from its localStorage.

  /** @returns {boolean} */
  function gmStorageAvailable() {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  }

  // ----- Standalone keys (kept out of the shared blob) -----
  // Frequently written state (playback positions, loop, last update check)
  // lives in its own key so a save never rewrites the blob or wakes the
  // cross-tab blob listener. GM storage when available, the same key name in
  // localStorage otherwise.

  /**
   * @param {string} key
   * @returns {string|null}
   */
  function readGmKey(/** @type {string} */ key) {
    return gmStorageAvailable() ? readRawGM(key) : readRaw(key);
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {boolean}
   */
  function writeGmKey(/** @type {string} */ key, /** @type {string} */ value) {
    return gmStorageAvailable() ? writeRawGM(key, value) : writeRaw(key, value);
  }

  /**
   * Whether this host may create the shared blob from its own localStorage.
   * The policy owns the answer; without it creation is disabled so a host
   * with a separate localStorage never overwrites the shared settings.
   * @returns {boolean}
   */
  function ownsSharedSettings() {
    const policy = window.YouTubePlusHostPolicy;
    return Boolean(
      policy && typeof policy.ownsSharedSettings === 'function' && policy.ownsSharedSettings()
    );
  }

  /**
   * Encode the settings view as the versioned blob. Per-module namespaces are
   * split out of `main` so the wire format is `{version, main, modules}`.
   * @param {Record<string, unknown>} settings
   * @returns {string}
   */
  function encodeBlob(settings) {
    /** @type {Record<string, unknown>} */
    const main = {};
    for (const key of Object.keys(settings)) {
      if (key === 'modules') continue;
      main[key] = settings[key];
    }
    const modules = _isPlainObject(settings.modules) ? settings.modules : {};
    return JSON.stringify({ version: BLOB_VERSION, main, modules });
  }

  /**
   * Parse a raw blob string into its envelope object, or null.
   * @param {string|null} raw
   * @returns {Record<string, unknown>|null}
   */
  function decodeBlob(raw) {
    const env = safeJSONParse(raw, null);
    return _isPlainObject(env) ? env : null;
  }

  /**
   * Read the main settings object out of a raw blob string.
   * @param {string|null} raw
   * @returns {Record<string, unknown>|null}
   */
  function decodeBlobMain(raw) {
    const env = decodeBlob(raw);
    const main = env ? env.main : null;
    return _isPlainObject(main) ? main : null;
  }

  /**
   * Read the per-module namespaces out of a parsed blob envelope.
   * @param {Record<string, unknown>|null} env
   * @returns {Record<string, unknown>}
   */
  function decodeBlobModules(env) {
    const modules = env ? env.modules : null;
    return _isPlainObject(modules) ? modules : {};
  }

  /**
   * Whether the shared blob is present in GM storage.
   * @returns {boolean}
   */
  function blobExists() {
    return gmStorageAvailable() && Boolean(readRawGM(GM_BLOB_KEY));
  }

  /**
   * Read one module namespace out of the shared blob.
   * @param {string} name
   * @returns {Record<string, unknown>|null}
   */
  function readBlobModule(name) {
    const modules = decodeBlobModules(decodeBlob(readRawGM(GM_BLOB_KEY)));
    const mod = modules[name];
    return _isPlainObject(mod) ? mod : null;
  }

  /**
   * Read the music settings from the legacy GM key or its localStorage mirror.
   * @returns {Record<string, unknown>|null}
   */
  function readLegacyMusic() {
    const gm = readRawGM(STORAGE_KEYS.music);
    if (gm) {
      const parsed = safeJSONParse(gm, null);
      if (_isPlainObject(parsed)) return parsed;
    }
    const ls = readRaw(STORAGE_KEYS.music);
    if (ls) {
      const parsed = safeJSONParse(ls, null);
      if (_isPlainObject(parsed)) return parsed;
    }
    return null;
  }

  /**
   * Choose where the main settings object is read from and written to. GM
   * storage is authoritative once the blob exists; on the owning host an
   * absent blob is seeded from localStorage, while every other host keeps its
   * own localStorage until a blob appears in GM storage.
   * @returns {{ kind: 'gm'|'local', create: boolean }}
   */
  function resolveMainBackend() {
    if (!gmStorageAvailable()) return { kind: 'local', create: false };
    if (readRawGM(GM_BLOB_KEY)) return { kind: 'gm', create: false };
    if (ownsSharedSettings()) return { kind: 'gm', create: true };
    return { kind: 'local', create: false };
  }

  // ----- Migration from basic.js SettingsManager (v2) -----
  /**
   * Merge a parsed music settings object with defaults + legacy flags.
   * Mirrors music.js mergeMusicSettings and getMusicSettings() to
   * keep cross-module compatibility.
   * @param {Record<string, unknown> | null | undefined} parsed
   * @returns {Record<string, unknown>}
   */
  function mergeMusicWithDefaults(
    /** @type {Record<string, unknown> | null | undefined} */ parsed
  ) {
    /** @type {Record<string, unknown>} */
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
   * Read YouTube Music settings. Once the shared blob exists they live in
   * `modules.music`; before that the legacy GM key / localStorage mirror stays
   * authoritative so a host that never saw the blob keeps working.
   * @returns {Record<string, unknown>}
   */
  function readMusic() {
    if (blobExists()) {
      const stored = readBlobModule('music');
      if (stored) return mergeMusicWithDefaults(stored);
      // The blob exists but music was never migrated into it: seed it once from
      // the legacy key so the stored values carry over.
      const merged = mergeMusicWithDefaults(readLegacyMusic());
      updateModuleSettings('music', merged);
      return merged;
    }
    return mergeMusicWithDefaults(readLegacyMusic());
  }

  // ----- Migration from basic.js SettingsManager (v2) -----
  // The legacy `youtube_plus_all_settings_v2` store used by
  // basic.js had a nested shape like
  //   { speedControl: { enabled }, download: { enabled } }
  // This function migrates a legacy object to the flat
  // shape used by the rest of the codebase.
  /**
   * @param {Record<string, unknown> | null | undefined} parsed
   * @returns {Record<string, unknown>|null}
   */
  function migrateLegacyV2(/** @type {Record<string, unknown> | null | undefined} */ parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    /** @type {Record<string, unknown>} */
    const out = {};
    const sc = /** @type {Record<string, unknown> | undefined} */ (parsed.speedControl);
    if (sc && typeof sc.enabled === 'boolean') out.enableSpeedControl = sc.enabled;
    const ss = /** @type {Record<string, unknown> | undefined} */ (parsed.screenshot);
    if (ss && typeof ss.enabled === 'boolean') out.enableScreenshot = ss.enabled;
    const dl = /** @type {Record<string, unknown> | undefined} */ (parsed.download);
    if (dl && typeof dl.enabled === 'boolean') out.enableDownload = dl.enabled;
    if (parsed.downloadSites && typeof parsed.downloadSites === 'object') {
      out.downloadSites = cloneJSON(parsed.downloadSites);
    }
    return Object.keys(out).length ? out : null;
  }

  // ----- Migration of legacy module on/off flags -----
  // Some modules keep their preferences (shortcuts, panel position, ...) in
  // their own storage key, whose `enabled` boolean is now a settings-store
  // key. On first load the boolean is copied into the store and dropped from
  // the legacy JSON, so the on/off state has a single writer afterwards.
  /** @type {ReadonlyArray<{ storeKey: string, legacyKey: string }>} */
  const LEGACY_FLAG_KEYS = Object.freeze([
    { storeKey: 'timecodeEnabled', legacyKey: 'youtube_timecode_settings' },
    { storeKey: 'endscreen', legacyKey: 'youtube_endscreen_settings' },
    { storeKey: 'shortsKeyboard', legacyKey: 'youtube_shorts_keyboard_settings' },
    { storeKey: 'enablePlaylistSearch', legacyKey: 'youtube_playlist_search_settings' },
    { storeKey: 'enableAdBlocker', legacyKey: 'youtube_adblocker_settings' },
    { storeKey: 'enablePip', legacyKey: 'youtube_pip_settings' },
    // The two stats flags are stored as a bare "true"/"false" string (or,
    // historically, a `{enabled}` object).
    { storeKey: 'enableStatsButton', legacyKey: 'youtube_stats_button_enabled' },
    { storeKey: 'enableChannelStats', legacyKey: 'youtube_channel_stats_settings' },
  ]);

  /**
   * @param {unknown} parsed stored settings object, or null when the main key did
   * not exist yet
   * @returns {Record<string, boolean>} the flags to copy into the store
   */
  // Keys renamed in 3.0: the interface styles were stored as `zenStyles` /
  // `enableZenStyles`. Old exports and stored settings carry those names.
  const RENAMED_KEYS = Object.freeze([
    ['zenStyles', 'styles'],
    ['enableZenStyles', 'enableStyles'],
  ]);

  /**
   * Move renamed keys to their new names in place; a value already stored
   * under the new name wins.
   * @param {Record<string, unknown>} obj
   * @returns {boolean} true when anything moved
   */
  function renameLegacyKeys(obj) {
    let changed = false;
    for (const [from, to] of RENAMED_KEYS) {
      if (!(from in obj)) continue;
      if (!(to in obj)) obj[to] = obj[from];
      delete obj[from];
      changed = true;
    }
    return changed;
  }

  /**
   * Read one legacy module flag. The payload is a JSON object with an `enabled`
   * field (dropped from the object on read), a JSON boolean, or a bare
   * "true"/"false" string.
   * @param {string} legacyKey
   * @returns {boolean|null}
   */
  function readLegacyFlag_(legacyKey) {
    const raw = readRaw(legacyKey);
    if (raw == null) return null;
    const parsed = safeJSONParse(raw, null);
    if (parsed && typeof parsed === 'object') {
      // A JSON object without `enabled` holds module settings, not a flag.
      if (!('enabled' in parsed)) return null;
      const enabled = parsed.enabled;
      delete parsed.enabled;
      writeRaw(legacyKey, JSON.stringify(parsed));
      return typeof enabled === 'boolean' ? enabled : null;
    }
    // A bare string or a JSON boolean is a scalar flag; anything else is
    // malformed or unrelated and is left untouched.
    if (!(typeof parsed === 'boolean' || raw === 'true' || raw === 'false')) return null;
    removeRaw(legacyKey);
    return parsed === true || raw === 'true';
  }

  function migrateLegacyFlags(/** @type {unknown} */ parsed) {
    /** @type {Record<string, boolean>} */
    const migrated = {};
    const hasStoreValue = (/** @type {string} */ key) =>
      Boolean(parsed && typeof parsed === 'object' && key in parsed);
    for (const { storeKey, legacyKey } of LEGACY_FLAG_KEYS) {
      const value = readLegacyFlag_(legacyKey);
      if (value !== null && !hasStoreValue(storeKey)) migrated[storeKey] = value;
    }
    return migrated;
  }

  // ----- Subscriptions -----
  /** @type {Map<string, Set<Function>>} */
  const subscribers = new Map();
  /**
   * Notify subscribers registered for `path` (exact path match).
   * @param {string} path
   * @param {unknown} value
   */
  function notifySubscribers(/** @type {string} */ path, /** @type {unknown} */ value) {
    if (!subscribers.size) return;
    const set = subscribers.get(path);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(value, path);
      } catch (e) {
        logS(e);
        safeLogWarn('SettingsStore', 'subscriber callback failed', e);
      }
    }
  }

  /**
   * Structural equality for JSON-safe setting values.
   * @param {unknown} a
   * @param {unknown} b
   * @returns {boolean}
   */
  function _deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ra = /** @type {Record<string, unknown>} */ (a);
    const rb = /** @type {Record<string, unknown>} */ (b);
    const ka = Object.keys(ra);
    const kb = Object.keys(rb);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!(Object.hasOwn(rb, k) && _deepEqual(ra[k], rb[k]))) return false;
    }
    return true;
  }

  /**
   * Compare subkeys of two object values and record differences into `changes`.
   * @param {unknown} pv
   * @param {unknown} nv
   * @param {string} parentKey
   * @param {Map<string, unknown>} changes
   */
  /**
   * True for plain data objects (not arrays, not null).
   * @param {unknown} v
   * @returns {v is Record<string, unknown>}
   */
  function _isPlainObject(v) {
    return Boolean(v && typeof v === 'object' && !Array.isArray(v));
  }

  /**
   * Compare subkeys of two object values and record differences into `changes`.
   * The walk is recursive: a change in a deeper leaf (e.g.
   * `downloadSiteCustomization.externalDownloader.name`) records the leaf's
   * full dot-path AND every intermediate object path, so subscribers on any
   * level are notified exactly once for the change.
   * @param {unknown} pv
   * @param {unknown} nv
   * @param {string} parentKey
   * @param {Map<string, unknown>} changes
   */
  function _collectSubkeyDiffs(pv, nv, parentKey, changes) {
    if (!(_isPlainObject(pv) || _isPlainObject(nv))) return;

    const subKeys = new Set([
      ...(_isPlainObject(pv) ? Object.keys(pv) : []),
      ...(_isPlainObject(nv) ? Object.keys(nv) : []),
    ]);
    for (const sk of subKeys) {
      const spv = _isPlainObject(pv) ? pv[sk] : undefined;
      const snv = _isPlainObject(nv) ? nv[sk] : undefined;
      const childPath = `${parentKey}.${sk}`;
      if (!_deepEqual(spv, snv)) {
        changes.set(childPath, snv);
      }
      if (_isPlainObject(spv) || _isPlainObject(snv)) {
        _collectSubkeyDiffs(spv, snv, childPath, changes);
      }
    }
  }

  /**
   * Map top-level / nested setting changes to feature alias subscriptions.
   * @param {Map<string, unknown>} changes
   * @param {Record<string, unknown>} next
   */
  function _mapFeatureAliasChanges(changes, next) {
    if (changes.has('styles') || Array.from(changes.keys()).some(k => k.startsWith('styles.'))) {
      changes.set('styles', cloneJSON(next.styles));
    }
    if (changes.has('enableDownload') || changes.has('downloadSites')) {
      changes.set('download', getFeature('download'));
    }
    if (changes.has('enableSpeedControl') || changes.has('speedControlHotkeys')) {
      changes.set('speed', getFeature('speed'));
    }
    if (changes.has('enableLoop') || changes.has('loopHotkeys')) {
      changes.set('loop', getFeature('loop'));
    }
    if (changes.has('enableScreenshot')) {
      changes.set('screenshot', getFeature('screenshot'));
    }
    const hasEnhancedChanges = [
      'enableEnhanced',
      'enableTabview',
      'enableCommentTranslate',
      'enablePlayAll',
      'enableResumeTime',
      'enableZoom',
      'enableThumbnail',
      'enablePlaylistSearch',
      'enableScrollToTopButton',
      'enableRememberManualQuality',
    ].some(k => changes.has(k));
    if (hasEnhancedChanges) {
      changes.set('enhanced', getFeature('enhanced'));
    }
    if (changes.has('music')) {
      changes.set('music', getMusicSettings());
    }
    // Music lives under `modules.music`; keep the feature alias reachable for
    // callers that still subscribe to `'music'`.
    if (
      Array.from(changes.keys()).some(k => k === 'modules.music' || k.startsWith('modules.music.'))
    ) {
      changes.set('music', getMusicSettings());
    }
  }

  /**
   * Notify subscribers for every path whose value actually changed
   * between two defaults-backfilled views. Top-level keys, nested dot-paths,
   * parent objects, feature aliases, and wildcard subscribers are notified.
   * @param {Record<string, unknown>|null} prev
   * @param {Record<string, unknown>} next
   */
  function _notifyChangedPaths(prev, next) {
    if (!subscribers.size) return;
    const p = prev || {};
    const n = next || {};
    const allKeys = new Set([...Object.keys(p), ...Object.keys(n)]);

    /** @type {Map<string, unknown>} */
    const changes = new Map();

    for (const k of allKeys) {
      const pv = p[k];
      const nv = n[k];
      if (!_deepEqual(pv, nv)) {
        changes.set(k, nv);
        _collectSubkeyDiffs(pv, nv, k, changes);
      }
    }

    if (!changes.size) return;

    _mapFeatureAliasChanges(changes, n);

    for (const [path, val] of changes.entries()) {
      notifySubscribers(path, cloneJSON(val));
    }

    notifySubscribers('*', cloneJSON(n));
  }

  // ----- Public API -----

  /**
   * Live in-memory settings view (defaults backfilled, legacy shape
   * migrated). Internal path for `set()`/`update()`/`updateFeature()`
   * which mutate it in place and persist via `save()`. Clear it on
   * cross-tab `storage` events or out-of-band writes. Public reads
   * (`load()`/`get()`) return protected snapshots of this object.
   * @type {Record<string, unknown>|null}
   */
  let _cache = null;

  /**
   * Storage backend resolved for the main settings object. Re-resolved on
   * every load so a blob appearing (or vanishing) in GM storage switches the
   * store without a restart.
   * @type {{ kind: 'gm'|'local', create: boolean }}
   */
  let _mainBackend = { kind: 'local', create: false };

  /** Last blob payload written here, to ignore an echo in the change listener. */
  /** @type {string|null} */
  let _lastWrittenBlob = null;

  /**
   * Mirror the theme preference into the localStorage cache that
   * design-system.js reads before the store finishes loading.
   * @param {Record<string, unknown>} settings
   */
  function syncThemeCache(settings) {
    const pref = getByPath(settings, 'styles.themePreference');
    if (pref !== 'dark' && pref !== 'light' && pref !== 'device') return;
    if (readRaw(THEME_CACHE_KEY) === pref) return;
    writeRaw(THEME_CACHE_KEY, pref);
  }

  /**
   * Persist a serialized settings object to the active backend and to the
   * localStorage mirror. The GM blob is authoritative; a failed GM write is
   * reported as false so callers fail closed.
   * @param {Record<string, unknown>} settings
   * @param {string} serialized
   * @returns {boolean}
   */
  function persistSerialized(settings, serialized) {
    if (_mainBackend.kind === 'gm') {
      const envelope = encodeBlob(settings);
      if (!writeRawGM(GM_BLOB_KEY, envelope)) return false;
      _lastWrittenBlob = envelope;
      writeRaw(STORAGE_KEYS.main, serialized);
      return true;
    }
    return writeRaw(STORAGE_KEYS.main, serialized);
  }

  /**
   * Serialize and persist a settings object through the active backend.
   * @param {Record<string, unknown>} settings
   * @returns {boolean}
   */
  function persistMain(settings) {
    /** @type {string} */
    let serialized;
    try {
      serialized = JSON.stringify(settings);
    } catch (e) {
      logS(e);
      safeLogWarn('SettingsStore', 'Failed to serialize settings', e);
      return false;
    }
    return persistSerialized(settings, serialized);
  }

  /**
   * Top-level keys whose value differs between two defaults-backfilled views.
   * @param {Record<string, unknown>|null} prev
   * @param {Record<string, unknown>} next
   * @returns {string[]}
   */
  function changedKeys(prev, next) {
    const p = prev || {};
    /** @type {string[]} */
    const keys = [];
    for (const k of new Set([...Object.keys(p), ...Object.keys(next)])) {
      if (_deepEqual(p[k], next[k])) continue;
      keys.push(k);
      if (k === 'modules') collectModuleKeys(p[k], next[k], keys);
    }
    return keys;
  }

  /**
   * Append the changed `modules.<name>` and `modules.<name>.<key>` paths so a
   * module can tell which of its own settings changed.
   * @param {unknown} prevModules
   * @param {unknown} nextModules
   * @param {string[]} keys
   */
  function collectModuleKeys(prevModules, nextModules, keys) {
    const pm = _isPlainObject(prevModules) ? prevModules : {};
    const nm = _isPlainObject(nextModules) ? nextModules : {};
    for (const name of new Set([...Object.keys(pm), ...Object.keys(nm)])) {
      if (_deepEqual(pm[name], nm[name])) continue;
      keys.push(`modules.${name}`);
      const pv = _isPlainObject(pm[name]) ? pm[name] : {};
      const nv = _isPlainObject(nm[name]) ? nm[name] : {};
      for (const sk of new Set([...Object.keys(pv), ...Object.keys(nv)])) {
        if (!_deepEqual(pv[sk], nv[sk])) keys.push(`modules.${name}.${sk}`);
      }
    }
  }

  /**
   * Dispatch the unified settings event. The changed top-level keys ride on
   * the event so subscribers can skip work for untouched settings.
   * @param {unknown} detail
   * @param {string[]} keys
   */
  function dispatchSettingsUpdated(detail, keys) {
    try {
      const event = new CustomEvent('youtube-plus-settings-updated', { detail });
      /** @type {CustomEvent & { changedKeys?: string[] }} */ (event).changedKeys = keys;
      window.dispatchEvent(event);
    } catch (_e) {
      logS(_e);
    }
  }

  /**
   * Apply a blob change written by another tab/context. The prior state
   * comes from the live cache, so only the settings that actually changed are
   * reported to subscribers.
   * @param {unknown} rawBlob
   */
  function applyRemoteBlob(rawBlob) {
    if (typeof rawBlob !== 'string' || rawBlob === _lastWrittenBlob) return;
    const env = decodeBlob(rawBlob);
    const main = env && _isPlainObject(env.main) ? env.main : null;
    if (!main) return;
    _mainBackend = resolveMainBackend();
    _commit({ ...main, modules: decodeBlobModules(env) }, { fromStorage: true });
  }

  /**
   * Apply backward compatibility migrations for legacy setting shapes.
   * @param {Record<string, unknown>} out
   * @param {unknown} parsed
   */
  function _applyLegacyMigrations(out, parsed) {
    if (!parsed || typeof parsed !== 'object') return;
    const p = /** @type {Record<string, unknown>} */ (parsed);
    const stylesOut = /** @type {Record<string, unknown> | undefined} */ (out.styles);
    if (p.hideSideGuide === true && stylesOut) {
      stylesOut.hideSideGuide = true;
    }
    const stylesIn = /** @type {Record<string, unknown> | undefined} */ (p.styles);
    if (stylesIn?.sideVideosTwoColumns === true && stylesOut) {
      if (!stylesOut.sideVideosColumns) {
        stylesOut.sideVideosColumns = 2;
      }
      stylesOut.sideVideosColumnsEnabled = true;
    }
  }

  /**
   * Merge a nested object setting against its default with type enforcement.
   * @param {Record<string, unknown>} defVal
   * @param {unknown} v
   * @returns {Record<string, unknown>}
   */
  function _mergeObjectField(defVal, v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return cloneJSON(defVal);
    }
    const ov = /** @type {Record<string, unknown>} */ (v);
    const res = cloneJSON(defVal);
    for (const k of Object.keys(ov)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (Object.hasOwn(res, k)) {
        res[k] = _mergeField(res[k], ov[k]);
      } else {
        res[k] = cloneJSON(ov[k]);
      }
    }
    return res;
  }

  /**
   * Merge an individual setting value against its registered default with type checking.
   * @param {unknown} defVal
   * @param {unknown} v
   * @returns {unknown}
   */
  function _mergeField(defVal, v) {
    if (defVal === undefined) {
      return v !== undefined ? cloneJSON(v) : undefined;
    }
    if (typeof defVal === 'boolean') {
      return typeof v === 'boolean' ? v : defVal;
    }
    if (typeof defVal === 'number') {
      return typeof v === 'number' && Number.isFinite(v) ? v : defVal;
    }
    if (typeof defVal === 'string') {
      return typeof v === 'string' ? v : defVal;
    }
    if (typeof defVal === 'object' && defVal !== null && !Array.isArray(defVal)) {
      return _mergeObjectField(/** @type {Record<string, unknown>} */ (defVal), v);
    }
    return cloneJSON(v);
  }

  /**
   * Merge a parsed settings object over the registered defaults.
   * Missing keys backfill; types are validated against defaults;
   * nested object values shallow-merge so partially saved sub-objects
   * keep their defaults.
   * @param {unknown} parsed
   * @returns {Record<string, unknown>}
   */
  function _mergeWithDefaults(/** @type {unknown} */ parsed) {
    /** @type {Record<string, unknown>} */
    const out = cloneJSON(DEFAULTS);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return out;
    }

    const op = /** @type {Record<string, unknown>} */ (parsed);
    for (const k of Object.keys(op)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const merged = _mergeField(out[k], op[k]);
      if (merged !== undefined) {
        out[k] = merged;
      }
    }

    _applyLegacyMigrations(out, op);
    return out;
  }

  /**
   * Load (or return) the live in-memory settings view. Reads the active
   * backend once per save-cycle, backfills defaults, and migrates
   * `youtube_plus_all_settings_v2` (basic.js SettingsManager legacy) when the
   * main key is missing. On the owning host an absent blob is seeded here.
   * @returns {Record<string, unknown>}
   */
  function _ensureLoaded() {
    if (_cache) return _cache;

    _mainBackend = resolveMainBackend();

    /** @type {string|null} */
    let raw = null;
    if (_mainBackend.kind === 'gm') {
      const env = decodeBlob(readRawGM(GM_BLOB_KEY));
      const blobMain = env && _isPlainObject(env.main) ? env.main : null;
      // Re-attach the module namespaces so the in-memory view carries them and
      // `encodeBlob` can write them back beside `main`.
      raw = blobMain
        ? JSON.stringify({ ...blobMain, modules: decodeBlobModules(env) })
        : readRaw(STORAGE_KEYS.main);
    } else {
      raw = readRaw(STORAGE_KEYS.main);
    }

    /** @type {unknown} */
    let parsed = safeJSONParse(raw, null);
    let migrated = Boolean(
      parsed &&
        typeof parsed === 'object' &&
        renameLegacyKeys(/** @type {Record<string, unknown>} */ (parsed))
    );
    const migratedFlags = migrateLegacyFlags(parsed);

    if (!parsed || typeof parsed !== 'object') {
      const legacyRaw = readRaw(STORAGE_KEYS.all);
      const legacyParsed = safeJSONParse(legacyRaw, null);
      const migratedLegacy = migrateLegacyV2(
        /** @type {Record<string, unknown> | null | undefined} */ (legacyParsed)
      );
      if (migratedLegacy) {
        parsed = migratedLegacy;
        migrated = true;
        try {
          localStorage.removeItem(STORAGE_KEYS.all);
        } catch (_e) {
          logS(_e);
          // ignore
        }
      }
    }

    _cache = _mergeWithDefaults(parsed);

    if (Object.keys(migratedFlags).length) {
      Object.assign(_cache, migratedFlags);
      migrated = true;
    }

    if (migrated || _mainBackend.create) {
      // Persist the migrated shape (and seed the blob on the owning host) so
      // future loads are fast and migration does not keep re-running.
      persistMain(_cache);
    }

    if (_mainBackend.kind === 'gm') syncThemeCache(_cache);

    return _cache;
  }

  /**
   * Load the settings as a protected snapshot:
   * missing keys backfill from defaults and the returned object is a
   * deep copy; mutating it never affects the store, and no
   * save/notification is implied. For in-place mutation use
   * `set()`/`update()`.
   * @returns {Record<string, unknown>}
   */
  function load() {
    return cloneJSON(_ensureLoaded());
  }

  /**
   * Single commit path for all settings mutations (save, set, update, import, storage events).
   * @param {Record<string, unknown>|null|undefined} rawNext
   * @param {{ fromStorage?: boolean, skipEvent?: boolean }} [options]
   * @returns {boolean}
   */
  function _commit(rawNext, options = {}) {
    const raw = rawNext && typeof rawNext === 'object' && !Array.isArray(rawNext) ? rawNext : {};
    // Prior state must come from the authoritative persisted
    // state. `_cache` can be null (invalidated by our own settings-updated
    // event or a cross-tab write). Falling back to DEFAULTS here made
    // sequential direct saves miss the false→true change notification.
    const prev = cloneJSON(_ensureLoaded());
    const next = _mergeWithDefaults(raw);

    if (!options.fromStorage) {
      /** @type {string} */
      let serialized;
      try {
        serialized = JSON.stringify(raw);
      } catch (e) {
        // A serialization failure must not be reported as success.
        logS(e);
        safeLogWarn('SettingsStore', 'Failed to serialize settings', e);
        return false;
      }
      // persistSerialized reports persistence failures (QuotaExceeded /
      // SecurityError / GM write) as `false`; a failed write must not update
      // the cache, notify subscribers, or dispatch the update event.
      if (!persistSerialized(raw, serialized)) {
        safeLogWarn('SettingsStore', 'Failed to persist settings; keeping previous snapshot', null);
        return false;
      }
    }

    _cache = cloneJSON(next);
    _notifyChangedPaths(prev, next);
    if (_mainBackend.kind === 'gm') syncThemeCache(next);

    if (!options.skipEvent && typeof window !== 'undefined') {
      dispatchSettingsUpdated(cloneJSON(next), changedKeys(prev, next));
    }

    return true;
  }

  /**
   * Save the settings: the single commit path
   * shared by `set()`/`update()`/`updateFeature()` and direct saves.
   * Persists the raw object, updates the protected snapshot cache,
   * notifies subscribers for every path that actually changed, and
   * dispatches `youtube-plus-settings-updated`.
   * @param {Record<string, unknown>|null|undefined} settings
   * @returns {boolean}
   */
  function save(/** @type {Record<string, unknown>|null|undefined} */ settings) {
    return _commit(settings);
  }

  /**
   * Get a setting by dot-path, with optional default. Object values
   * are returned as deep snapshot copies; mutating the result never
   * affects the store. Primitives are returned as-is.
   * @param {string} path
   * @param {unknown} [defaultValue]
   * @returns {unknown}
   */
  function get(/** @type {string} */ path, /** @type {unknown} */ defaultValue) {
    const v = getByPath(_ensureLoaded(), path);
    if (v === undefined) return defaultValue;
    if (v !== null && typeof v === 'object') {
      return cloneJSON(v);
    }
    return v;
  }

  // ----- Cache invalidation on external writes -----
  // `storage` fires in other tabs/windows that mutate stored data; we
  // re-read the main key, notify subscribers for paths that
  // actually changed, and prime the cache so the next read skips the
  // parse. `youtube-plus-settings-updated` is dispatched by this module
  // on every save(), but it's also a public coordination point for any
  // code path that may have written the main key out-of-band. Both
  // listeners are installed once per IIFE; they're window-scoped and
  // live for the lifetime of the page, so no per-instance teardown is
  // needed.
  /**
   * Register a page-lifetime window listener through the CleanupManager and
   * return its key. Registration failures are reported, never thrown.
   * @template {Event} E
   * @param {string} name
   * @param {(event: E) => void} handler
   * @returns {symbol | null}
   */
  function registerWindowListener(name, handler) {
    try {
      return (
        window.YouTubePlusCleanupManager?.registerListener?.(
          window,
          name,
          handler,
          undefined,
          true
        ) ?? null
      );
    } catch (_e) {
      logS(_e);
      return null;
    }
  }

  /**
   * Unregister a window listener by its handle.
   * @param {symbol | null | undefined} handle
   */
  function unregisterWindowListener(handle) {
    if (!handle) return;
    try {
      window.YouTubePlusCleanupManager?.unregisterListener?.(handle);
    } catch (_e) {
      logS(_e);
    }
  }

  /**
   * React to a blob change written by another tab or subdomain.
   * @param {string} _name
   * @param {unknown} oldValue
   * @param {unknown} newValue
   */
  function onGmBlobChange(_name, oldValue, newValue) {
    if (newValue === oldValue) return;
    applyRemoteBlob(newValue);
  }

  if (typeof window !== 'undefined') {
    unregisterWindowListener(window._ytpSettingsStoreStorageKey);
    unregisterWindowListener(window._ytpSettingsStoreUpdateKey);
    window._ytpSettingsStoreStorageKey = registerWindowListener(
      'storage',
      (/** @type {StorageEvent} */ event) => {
        // GM storage is authoritative once the blob exists; the blob change
        // listener owns cross-context sync in that mode.
        if (_mainBackend.kind === 'gm') return;
        const key = event?.key;
        // A null key means storage was cleared wholesale; treat it like a
        // change to the main key.
        if (key != null && key !== STORAGE_KEYS.main) return;
        const raw = readRaw(STORAGE_KEYS.main);
        const parsed = safeJSONParse(raw, null);
        _commit(/** @type {Record<string, unknown> | null | undefined} */ (parsed), {
          fromStorage: true,
        });
      }
    );
    window._ytpSettingsStoreUpdateKey = registerWindowListener(
      'youtube-plus-settings-updated',
      () => {
        _cache = null;
      }
    );
    if (typeof GM_addValueChangeListener === 'function' && !window._ytpSettingsStoreGmListenerId) {
      // Registered once per page; the handle is kept so a re-evaluation does
      // not attach a second listener.
      try {
        window._ytpSettingsStoreGmListenerId = GM_addValueChangeListener(
          GM_BLOB_KEY,
          onGmBlobChange
        );
      } catch (_e) {
        logS(_e);
      }
    }
  }

  /**
   * Set a setting by dot-path, persist via single commit path, and notify subscribers.
   * @param {string} path
   * @param {unknown} value
   * @returns {boolean}
   */
  function set(/** @type {string} */ path, /** @type {unknown} */ value) {
    if (typeof path !== 'string' || !path) return false;
    const current = cloneJSON(_ensureLoaded());
    if (!setByPath(current, path, value)) return false;
    return _commit(current);
  }

  /**
   * Patch a setting by dot-path. The patch is shallow-merged into
   * the existing object at `path` (if it is an object) or replaces
   * the value (if it is a primitive). Persists via single commit path and notifies.
   * @param {string} path
   * @param {Record<string, unknown>} patch
   * @returns {boolean}
   */
  function update(/** @type {string} */ path, /** @type {Record<string, unknown>} */ patch) {
    if (typeof path !== 'string' || !path) return false;
    const current = cloneJSON(_ensureLoaded());
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
    return _commit(current);
  }

  /**
   * Get a feature's settings subset. Music uses the dual-storage
   * music bridge; other features return the store values
   * overlaid on the feature defaults.
   * @param {string} featureId
   * @returns {Record<string, unknown>}
   */
  function getFeature(/** @type {string} */ featureId) {
    if (featureId === 'music') return getMusicSettings();
    const defaults = FEATURE_DEFAULTS[featureId];
    const current = _ensureLoaded();
    if (!defaults) {
      return current[featureId] != null
        ? /** @type {Record<string, unknown>} */ (cloneJSON(current[featureId]))
        : {};
    }
    /** @type {Record<string, unknown>} */
    const out = /** @type {Record<string, unknown>} */ (cloneJSON(defaults));
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(current, k)) {
        out[k] = cloneJSON(current[k]);
      }
    }
    return out;
  }

  /**
   * Update a feature's settings subset. Patches are shallow-merged
   * into the feature's top-level keys. Persists via single commit path and notifies.
   * @param {string} featureId
   * @param {Record<string, unknown>|null|undefined} patch
   * @returns {boolean}
   */
  function updateFeature(
    /** @type {string} */ featureId,
    /** @type {Record<string, unknown>|null|undefined} */ patch
  ) {
    if (!(featureId && patch) || typeof patch !== 'object' || Array.isArray(patch)) return false;
    if (featureId === 'music') {
      // Delegate to the music bridge so all music writes
      // share a single notification + persistence path.
      return updateMusicSettings(patch);
    }
    const defaults = FEATURE_DEFAULTS[featureId];
    if (!defaults) return false;
    const current = cloneJSON(_ensureLoaded());
    for (const k of Object.keys(defaults)) {
      if (Object.hasOwn(patch, k)) {
        current[k] = cloneJSON(patch[k]);
      }
    }
    return _commit(current);
  }

  // ============================================================
  // MODULE SETTINGS BRIDGE
  // ------------------------------------------------------------
  // A feature that keeps its own settings stores them under a namespace in the
  // shared blob (`modules.<name>`). The store owns the read/write so a module
  // never touches GM storage directly and a remote change reaches every tab
  // through the single settings-updated event.
  // ============================================================

  /**
   * Read a module namespace from the shared blob. Returns an empty object when
   * the module has not stored anything yet.
   * @param {string} name
   * @returns {Record<string, unknown>}
   */
  function getModuleSettings(/** @type {string} */ name) {
    if (typeof name !== 'string' || !name) return {};
    const current = _ensureLoaded();
    const modules = _isPlainObject(current.modules) ? current.modules : {};
    return _isPlainObject(modules[name]) ? cloneJSON(modules[name]) : {};
  }

  /**
   * Whether the shared blob is present in GM storage. Modules use it to decide
   * between the blob bridge and their legacy key, and to migrate only where the
   * blob already exists.
   * @returns {boolean}
   */
  function hasSharedSettings() {
    return blobExists();
  }

  /**
   * The store itself when the shared blob is active, else null. Lets a module
   * pick the blob bridge over its legacy key by a single call.
   * @returns {YouTubePlusSettingsStore | null}
   */
  function moduleBridge() {
    return blobExists() ? /** @type {YouTubePlusSettingsStore} */ (SettingsStore) : null;
  }

  /**
   * Whether a settings-updated event concerns one module. An event without a
   * changed-key list is treated as affecting everything. A `modules.<name>`
   * namespace or a `modules.<name>.<key>` path matches, so a sibling name
   * sharing the prefix does not. A bare `modules` matches only a wholesale
   * reset (no per-module path); `alsoKeys` covers a module's settings that
   * still live outside its namespace.
   * @param {unknown} event
   * @param {string} name
   * @param {string[]} [alsoKeys]
   * @returns {boolean}
   */
  function affectsModule(event, name, alsoKeys = []) {
    const keys = /** @type {{ changedKeys?: unknown }|null|undefined} */ (event)?.changedKeys;
    if (!Array.isArray(keys)) return true;
    const prefix = `modules.${name}.`;
    let sawModulesRoot = false;
    let sawModulePath = false;
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      if (key === `modules.${name}` || key.startsWith(prefix)) return true;
      if (alsoKeys.includes(key)) return true;
      if (key === 'modules') sawModulesRoot = true;
      else if (key.startsWith('modules.')) sawModulePath = true;
    }
    // A bare `modules` with no per-module path is a wholesale reset, so every
    // module re-applies; with paths present the change belongs to those modules.
    return sawModulesRoot && !sawModulePath;
  }

  /**
   * Shallow-merge a patch into a module namespace and commit it through the
   * shared blob. Never creates the blob on its own: a module write only lands
   * where the shared settings already exist.
   * @param {string} name
   * @param {Record<string, unknown>} patch
   * @returns {boolean}
   */
  function updateModuleSettings(
    /** @type {string} */ name,
    /** @type {Record<string, unknown>} */ patch
  ) {
    if (typeof name !== 'string' || !name || !_isPlainObject(patch)) return false;
    if (!blobExists()) return false;
    const current = cloneJSON(_ensureLoaded());
    const modules = _isPlainObject(current.modules) ? current.modules : {};
    const existing = _isPlainObject(modules[name]) ? modules[name] : {};
    modules[name] = { ...existing, ...cloneJSON(patch) };
    current.modules = modules;
    return _commit(current);
  }

  // ============================================================
  // MUSIC BRIDGE
  // ------------------------------------------------------------
  // YouTube Music settings are shared between youtube.com and
  // music.youtube.com. They live in `modules.music` of the shared blob; until
  // the blob exists the legacy GM key and its localStorage mirror stay
  // authoritative. The merged shape includes legacy flag migration.
  // ============================================================

  /**
   * Read YouTube Music settings from the store. Returns
   * a fresh merged object on every call. Falls back to defaults
   * if nothing is stored.
   * @returns {Record<string, unknown>}
   */
  function getMusicSettings() {
    return readMusic();
  }

  /**
   * Shallow-merge a patch into the current music settings. Inside the blob the
   * change goes to `modules.music` and the unified event carries the
   * `modules.music.*` paths; before the blob exists the legacy GM key is
   * written and the event carries `music`.
   * @param {Record<string, unknown>|null|undefined} patch
   * @returns {boolean}
   */
  function updateMusicSettings(/** @type {Record<string, unknown>|null|undefined} */ patch) {
    if (!patch || typeof patch !== 'object') return false;
    const merged = mergeMusicWithDefaults({ ...readMusic(), ...patch });
    if (blobExists()) {
      return updateModuleSettings('music', merged);
    }
    const serialized = JSON.stringify(merged);
    writeRaw(STORAGE_KEYS.music, serialized);
    writeRawGM(STORAGE_KEYS.music, serialized);
    notifySubscribers('music', cloneJSON(merged));
    if (typeof window !== 'undefined') {
      dispatchSettingsUpdated({ music: cloneJSON(merged) }, ['music']);
    }
    return true;
  }

  /**
   * Subscribe to in-page music settings changes. Returns an
   * unsubscribe function. Note: cross-subdomain changes delivered
   * via `GM_addValueChangeListener` are not captured here; the
   * music module owns that listener for live sync.
   * @param {(value: Record<string, unknown>, target: string) => void} callback
   * @returns {() => void}
   */
  function subscribeMusicSettings(
    /** @type {(value: Record<string, unknown>, target: string) => void} */ callback
  ) {
    return subscribe('music', callback);
  }

  /**
   * Subscribe to changes for a path or feature id. Returns an
   * idempotent unsubscribe function. The callback receives `(value, target)`.
   * @param {string} pathOrFeature
   * @param {(value: Record<string, unknown>, target: string) => void} callback
   * @returns {() => void}
   */
  function subscribe(
    /** @type {string} */ pathOrFeature,
    /** @type {(value: Record<string, unknown>, target: string) => void} */ callback
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
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const s = subscribers.get(pathOrFeature);
      if (!s) return;
      s.delete(/** @type {Function} */ (/** @type {unknown} */ (callback)));
      if (!s.size) subscribers.delete(pathOrFeature);
    };
  }

  /**
   * Type-check an object value against its object template.
   * @param {unknown} value
   * @param {Record<string, unknown>} template
   * @returns {boolean}
   */
  function matchesObjectTemplate_(value, template) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const ov = /** @type {Record<string, unknown>} */ (value);
    for (const k of Object.keys(ov)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (!Object.hasOwn(template, k)) return false;
      if (!matchesDefaultsType_(ov[k], template[k])) return false;
    }
    return true;
  }

  /**
   * Type-check a candidate value against its DEFAULTS template.
   * Object templates are validated recursively: the incoming value may omit
   * keys (partial merge), but every key it carries must exist in the
   * template and match the nested type. An empty-object template is a free-form
   * map (the `modules` namespaces), so any plain object without dangerous
   * prototype keys is accepted. Dangerous prototype keys are skipped like at
   * the top level.
   * @param {unknown} value
   * @param {unknown} template
   * @returns {boolean}
   */
  function matchesDefaultsType_(value, template) {
    if (template === undefined || template === null) return true;
    if (Array.isArray(template)) return Array.isArray(value);
    if (typeof template !== 'object') return typeof value === typeof template;
    if (Object.keys(template).length === 0) {
      return _isPlainObject(value) && !hasDangerousKey_(value);
    }
    return matchesObjectTemplate_(value, /** @type {Record<string, unknown>} */ (template));
  }

  /**
   * Whether an object carries a prototype-polluting key anywhere in its tree.
   * @param {Record<string, unknown>} obj
   * @returns {boolean}
   */
  function hasDangerousKey_(obj) {
    for (const k of Object.keys(obj)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
      const v = obj[k];
      if (_isPlainObject(v) && hasDangerousKey_(v)) return true;
    }
    return false;
  }

  /**
   * Import settings from a JSON string or object.
   * This genuinely validates: every incoming key must be
   * registered in KEY_REGISTRY and its value must match the DEFAULTS type
   * (nested objects recursively). The import is all-or-nothing: a payload
   * with any unknown key or type mismatch is rejected without committing.
   * Dangerous prototype keys are skipped like in every other writer.
   * @param {string|Record<string, unknown>|null|undefined} data
   * @returns {boolean}
   */
  function importSettings(data) {
    if (!data) return false;
    /** @type {unknown} */
    let parsed = data;
    if (typeof data === 'string') {
      parsed = safeJSONParse(data, null);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return false;
    }
    const defaultsIndex = /** @type {Record<string, unknown>} */ (DEFAULTS);
    const op = /** @type {Record<string, unknown>} */ (parsed);
    renameLegacyKeys(op);
    for (const k of Object.keys(op)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (!(KEY_REGISTRY.has(k) && matchesDefaultsType_(op[k], defaultsIndex[k]))) {
        return false;
      }
    }
    const current = cloneJSON(_ensureLoaded());
    for (const k of Object.keys(op)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      current[k] = cloneJSON(op[k]);
    }
    return _commit(current);
  }

  /**
   * Reset to defaults. Writes the default blob to GM storage on the owning
   * host, removes the localStorage mirror, and dispatches an update event.
   * Use with care: module-level caches (e.g. music.js snapshot) are not
   * touched; callers should reload after reset.
   */
  function reset() {
    const defaults = cloneJSON(DEFAULTS);
    if (_mainBackend.kind === 'gm' || resolveMainBackend().kind === 'gm') {
      const envelope = encodeBlob(defaults);
      if (writeRawGM(GM_BLOB_KEY, envelope)) _lastWrittenBlob = envelope;
    }
    removeRaw(STORAGE_KEYS.main);
    _cache = null;
    if (typeof window !== 'undefined') {
      dispatchSettingsUpdated(cloneJSON(DEFAULTS), Object.keys(DEFAULTS));
    }
  }

  /** Internal helpers exposed for testing and advanced callers. */
  const _internals = Object.freeze({
    STORAGE_KEYS,
    DEFAULTS,
    MUSIC_DEFAULTS,
    FEATURE_DEFAULTS,
    KEY_REGISTRY,
    GM_BLOB_KEY,
    THEME_CACHE_KEY,
    readMusic,
    readLegacyMusic,
    migrateLegacyV2,
    mergeMusicWithDefaults,
    encodeBlob,
    decodeBlob,
    decodeBlobMain,
    decodeBlobModules,
    readBlobModule,
    blobExists,
    hasSharedSettings,
    resolveMainBackend,
    ownsSharedSettings,
    _commit,
    _notifyChangedPaths,
    _deepEqual,
  });

  /**
   * Validate that a settings key or dot-path is registered in KEY_REGISTRY / DEFAULTS.
   * Validates top-level keys against KEY_REGISTRY and nested segments against DEFAULTS.
   * @param {string} key - A settings key or dot-path (e.g. "enableDownload" or "styles.themeVariant")
   * @returns {boolean}
   */
  function hasKey(/** @type {string} */ key) {
    if (typeof key !== 'string' || !key) return false;
    const parts = key.split('.').filter(Boolean);
    if (!parts.length) return false;
    const root = parts[0];
    if (!KEY_REGISTRY.has(root)) return false;
    if (parts.length === 1) return true;
    let current = /** @type {Record<string, unknown>} */ (DEFAULTS);
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return false;
      if (!Object.hasOwn(current, part)) return false;
      current = /** @type {Record<string, unknown>} */ (current[part]);
    }
    return true;
  }

  /** Settings store. The single source of truth for the
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
    importSettings,
    // Generic access.
    get,
    set,
    update,
    hasKey,
    // Feature-scoped access.
    getFeature,
    updateFeature,
    // Module namespaces in the shared blob (modules.<name>).
    getModuleSettings,
    updateModuleSettings,
    hasSharedSettings,
    moduleBridge,
    affectsModule,
    // Standalone key IO (outside the blob); see readGmKey/writeGmKey above.
    readGmKey,
    writeGmKey,
    // Subscriptions.
    subscribe,
    // Raw key/value escape hatch for boundary-adjacent modules
    // (utils.storage, per-feature keys like download history, zoom pan).
    // These are the ONLY sanctioned raw storage primitives.
    readRaw,
    writeRaw,
    removeRaw,
    clearRaw,
    // Music bridge (accessors for the modules.music namespace).
    getMusicSettings,
    updateMusicSettings,
    subscribeMusicSettings,
    // Lifecycle.
    reset,
    // Advanced (testing / migration tooling).
    _internals,
  });

  // Export the settings store.
  if (typeof window !== 'undefined') {
    window.YouTubePlusSettingsStore = /** @type {YouTubePlusSettingsStore} */ (SettingsStore);
  }

  // Load once at boot so stored-shape migrations (renamed keys, legacy
  // flags) are written back before modules that read the raw key run.
  _ensureLoaded();
})();
