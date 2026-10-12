/**
 * YouTube Music Enhancement Module
 * UI improvements for YouTube Music: navigation and immersive-search styles,
 * sidebar hover effects, centered player and player bar options.
 * @module music
 */

/* global GM_addValueChangeListener */

(function () {
  const U = window.YouTubeUtils;
  /**
   * @param {unknown} err
   * @param {string} [label]
   */
  const logS = (err, label = undefined) => U?.logSuppressed?.(err, label || 'Music');
  const withErrorBoundary = U.createWithErrorBoundary('Music');

  if (typeof location !== 'undefined' && location.hostname !== 'music.youtube.com') {
    return;
  }

  const musicLogger = U?.logger || null;

  U?.StyleManager?.add?.(
    'yp-music-fab-styles',
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-fab-styles') || ''
  );

  // YouTube Music settings live in the settings store
  // (window.YouTubePlusSettingsStore); reads delegate to it.

  /**
   * Flat YouTube Music settings: one boolean per style bundle plus
   * `enableMusic`. The style keys are read dynamically, hence the index
   * signature.
   * @typedef {Record<string, boolean | undefined>} MusicSettings
   */

  /**
   * Read YouTube Music settings from the settings store.
   * @returns {MusicSettings}
   */
  function readMusicSettings() {
    const store = typeof window !== 'undefined' ? window.YouTubePlusSettingsStore : null;
    if (store && typeof store.getMusicSettings === 'function') {
      return /** @type {MusicSettings} */ (store.getMusicSettings());
    }
    return {
      enableMusic: true,
      immersiveSearchStyles: true,
      hoverStyles: true,
      playerSidebarStyles: true,
      centeredPlayerStyles: true,
      playerBarStyles: true,
      centeredPlayerBarStyles: true,
      miniPlayerStyles: true,
      scrollToTopStyles: true,
    };
  }

  /** @param {MusicSettings} settings */
  function isMusicModuleEnabled(settings) {
    return !!settings?.enableMusic;
  }

  /**
   * Mutable settings snapshot for live-apply.
   * @type {ReturnType<typeof readMusicSettings>}
   */
  let musicSettingsSnapshot = readMusicSettings();

  /** Enhanced styles: navigation cleanup, immersive search, sidebar, centered player. @type {string} @const */
  const enhancedStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-enhanced-styles') || '';

  const immersiveSearchStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-immersive-search-styles') || '';

  const hoverStyles = window.YouTubePlusDesignSystem?.getStyle?.('yp-music-hover-styles') || '';

  const playerSidebarStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-player-sidebar-styles') || '';

  const centeredPlayerStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-centered-player-styles') || '';

  const playerBarStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-player-bar-styles') || '';

  const centeredPlayerBarStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-centered-player-bar-styles') || '';

  const miniPlayerStyles =
    window.YouTubePlusDesignSystem?.getStyle?.('yp-music-mini-player-styles') || '';

  /** Optional CSS bundles gated by one settings flag each, in apply order. */
  const OPTIONAL_STYLE_PARTS = [
    ['immersiveSearchStyles', immersiveSearchStyles],
    ['hoverStyles', hoverStyles],
    ['playerSidebarStyles', playerSidebarStyles],
    ['centeredPlayerStyles', centeredPlayerStyles],
    ['playerBarStyles', playerBarStyles],
    ['centeredPlayerBarStyles', centeredPlayerBarStyles],
    ['miniPlayerStyles', miniPlayerStyles],
  ];

  /**
   * @param {MusicSettings} s
   * @returns {string[]}
   */
  const collectEnabledStyleParts = s => {
    const parts = [enhancedStyles];
    for (const [key, css] of OPTIONAL_STYLE_PARTS) {
      if (s[key]) parts.push(css);
    }
    return parts;
  };

  /**
   * Apply every enabled music CSS bundle through the StyleManager
   * (`add()` is idempotent, so settings changes reuse the same keys).
   * @returns {void}
   */
  function applyStyles() {
    if (!U?.isMusicDomain?.()) return;

    const s = musicSettingsSnapshot || readMusicSettings();
    if (!s.enableMusic) return;

    const allStyles = `\n${collectEnabledStyleParts(s).join('\n')}\n`;
    U?.StyleManager?.add?.('youtube-plus-music-styles', allStyles);
    // Drop a standalone <style id="youtube-plus-music-styles"> if one is
    // present, so the same CSS is not applied twice.
    document.querySelectorAll('#youtube-plus-music-styles').forEach(el => el.remove());
    U?.logger?.debug?.('[YouTube+][Music]', 'Styles applied');
  }

  function startIfEnabled() {
    // Never start outside YouTube Music.
    if (!U?.isMusicDomain?.()) return;

    musicSettingsSnapshot = readMusicSettings();
    if (!isMusicModuleEnabled(musicSettingsSnapshot)) return;

    if (document.readyState === 'loading') {
      window.YouTubePlusCleanupManager?.registerListener?.(
        document,
        'DOMContentLoaded',
        applyStyles,
        {
          once: true,
        },
        true
      );
    } else {
      applyStyles();
    }
  }

  function applySettingsChanges() {
    musicSettingsSnapshot = readMusicSettings();

    // Disabled: drop the CSS entry from the shared style host right away,
    // regardless of hostname.
    if (!isMusicModuleEnabled(musicSettingsSnapshot)) {
      U?.StyleManager?.remove?.('youtube-plus-music-styles');
      document.querySelectorAll('#youtube-plus-music-styles').forEach(el => el.remove());
      return;
    }

    if (!U?.isMusicDomain?.()) return;
    applyStyles();
  }

  /** @param {unknown} s */
  function saveSettings(s) {
    // The caller (modal-handlers) persists through the settings store; this
    // only keeps the in-memory snapshot in sync for live-apply.
    if (s && typeof s === 'object') {
      musicSettingsSnapshot = { ...musicSettingsSnapshot, ...s };
    } else {
      musicSettingsSnapshot = readMusicSettings();
    }
  }

  const isMusicRoute = () => U?.isMusicDomain?.() ?? false;

  // Export for settings live-apply; the second name is the legacy alias.
  if (typeof window !== 'undefined') {
    window.YouTubePlusMusic = {
      saveSettings,
      applySettingsChanges,
    };
    window.YouTubeMusic = window.YouTubePlusMusic;
  }

  let musicRuntimeStarted = false;
  const startMusicRuntime = () => {
    if (musicRuntimeStarted) return;
    musicRuntimeStarted = true;

    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'beforeunload',
      () => {
        U?.StyleManager?.remove?.('youtube-plus-music-styles');
        U?.logger?.debug?.('[YouTube+][Music]', 'Cleanup completed');
      },
      undefined,
      true
    );

    // Start only if enabled; otherwise remain dormant.
    startIfEnabled();

    // Live sync: the store dispatches one event for a blob change in any tab or
    // window. Only music keys matter here.
    window.YouTubePlusCleanupManager?.registerListener?.(
      window,
      'youtube-plus-settings-updated',
      (/** @type {CustomEvent & { changedKeys?: string[] }} */ event) => {
        // The pre-blob path signals music changes with the `music` alias.
        if (window.YouTubePlusSettingsStore?.affectsModule?.(event, 'music', ['music']) === false) {
          return;
        }
        musicSettingsSnapshot = readMusicSettings();
        applySettingsChanges();
      },
      undefined,
      true
    );

    // Only before the shared blob exists does the legacy GM key stay
    // authoritative, so watch it for cross-tab sync in that window alone.
    try {
      if (
        typeof GM_addValueChangeListener !== 'undefined' &&
        window.YouTubePlusSettingsStore?.hasSharedSettings?.() !== true
      ) {
        GM_addValueChangeListener('youtube-plus-music-settings', () => {
          musicSettingsSnapshot = readMusicSettings();
          applySettingsChanges();
        });
      }
    } catch (e) {
      logS(e);
      musicLogger?.warn?.('Music', 'Settings listener registration error', e);
    }

    U?.logger?.debug?.('[YouTube+][Music]', 'Module loaded (lazy)', {
      hostname: U?.getHostname?.() ?? '',
      enabled: isMusicRoute() && isMusicModuleEnabled(musicSettingsSnapshot),
    });
  };

  // Activate on `music.youtube.com` only.
  U?.whenRelevant?.({
    name: 'music',
    isRelevant: () =>
      (U?.isMusicDomain?.() ?? false) && isMusicModuleEnabled(musicSettingsSnapshot),
    onEnter: withErrorBoundary(startMusicRuntime, 'runtime'),
  });
})();
