// Performance mode runtime.
//
// Responsibility: the opt-in, route-scoped page-cost reductions. Each part is
//   its own FeatureLifecycle feature, so it starts only on the routes it can
//   help and only while both the master `performanceMode` setting and its own
//   toggle are on. Every reduction is CSS-only except the lazy chat, which
//   defers the chat iframe until the panel is opened.
//   The settings submenu itself is part of the settings modal markup
//   (settings-helpers.js), not of this module.
// Public surface: window.YouTubePlusPerformanceMode (test hooks only).
(function () {
  const U = window.YouTubeUtils;
  const logS = (/** @type {unknown} */ _err, /** @type {string|undefined} */ _label = undefined) =>
    U?.logSuppressed?.(_err, _label || 'PerformanceMode');

  const MASTER_KEY = 'performanceMode';

  /** @type {YouTubePlusRoute[]} */
  const WATCH_ONLY = ['watch'];
  /** @type {YouTubePlusRoute[]} */
  const PREVIEW_ROUTES = ['home', 'feed', 'search', 'channel', 'watch'];

  /** The four parts, in settings-submenu order. */
  const PARTS = Object.freeze([
    {
      id: 'performanceMode.ambient',
      setting: 'performanceModeAmbient',
      styleId: 'yp-perf-ambient',
      routeKey: 'ambient',
      routes: WATCH_ONLY,
    },
    {
      id: 'performanceMode.hoverPreview',
      setting: 'performanceModeHoverPreview',
      styleId: 'yp-perf-hover-preview',
      routeKey: 'hoverPreview',
      routes: PREVIEW_ROUTES,
    },
    {
      id: 'performanceMode.contentVisibility',
      setting: 'performanceModeContentVisibility',
      styleId: 'yp-perf-content-visibility',
      routeKey: 'contentVisibility',
      routes: PREVIEW_ROUTES,
    },
    {
      id: 'performanceMode.lazyChat',
      setting: 'performanceModeLazyChat',
      styleId: null,
      routeKey: 'lazyChat',
      routes: WATCH_ONLY,
    },
  ]);

  const CSS = Object.freeze({
    // The ambient glow YouTube paints behind the player is pure decoration.
    ambient: '#cinematics,#cinematic-container{display:none!important}',
    // Inline preview and animated thumbnails are triggered on hover; hiding
    // their hosts removes the work without touching any listener.
    hoverPreview:
      'ytd-video-preview,#video-preview,#inline-preview-player,' +
      'ytd-thumbnail-overlay-hover-preview-renderer,ytd-thumbnail-overlay-loading-preview-renderer,' +
      'ytd-moving-thumbnail-renderer{display:none!important}',
    // Let the browser skip layout/paint for off-screen rows until they matter.
    contentVisibility:
      'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,ytd-rich-grid-media' +
      '{content-visibility:auto;contain-intrinsic-size:auto 340px}' +
      'ytd-comment-thread-renderer,ytd-comment-renderer' +
      '{content-visibility:auto;contain-intrinsic-size:auto 200px}',
  });

  const store = () => window.YouTubePlusSettingsStore;
  const masterOn = () => store()?.get?.(MASTER_KEY) === true;
  /** @param {string} key */
  const partOn = key => store()?.get?.(key) !== false;

  /**
   * Defer the live-chat iframe until the chat panel is opened: strip its src
   * while the frame is collapsed and restore it on the first open. The frame
   * element is never removed, so YouTube's own bindings stay intact.
   * @param {YouTubePlusFeatureContext} ctx
   */
  const setupLazyChat = ctx => {
    const coordinator = window.YouTubePlusMutationCoordinator;
    /** @type {Set<HTMLIFrameElement>} */
    const deferred = new Set();

    const frame = () => document.querySelector('ytd-live-chat-frame');
    const isOpen = () => {
      const el = frame();
      if (!el) return false;
      return el.hasAttribute('expanded') || el.getAttribute('expanded') === 'true';
    };

    /** @param {Element | null | undefined} node */
    const defer = node => {
      const iframe = /** @type {HTMLIFrameElement | null} */ (
        node instanceof HTMLIFrameElement
          ? node
          : node?.querySelector?.('iframe#chatframe') || node?.querySelector?.('iframe')
      );
      if (!(iframe instanceof HTMLIFrameElement) || deferred.has(iframe)) return;
      if (isOpen()) return;
      const src = iframe.getAttribute('src');
      if (!src || src === 'about:blank') return;
      try {
        iframe.dataset.ypLazyChatSrc = src;
        iframe.setAttribute('src', 'about:blank');
        deferred.add(iframe);
      } catch (e) {
        logS(e);
      }
    };

    const restore = () => {
      for (const iframe of deferred) {
        const src = iframe.dataset?.ypLazyChatSrc;
        if (!src) continue;
        try {
          iframe.setAttribute('src', src);
          delete iframe.dataset.ypLazyChatSrc;
        } catch (e) {
          logS(e);
        }
      }
      deferred.clear();
    };

    document.querySelectorAll('ytd-live-chat-frame').forEach(defer);

    if (coordinator?.subscribeRoot) {
      const subId = 'performanceMode::lazyChat';
      coordinator.subscribeRoot(
        subId,
        () => {
          if (isOpen()) {
            restore();
            return;
          }
          document.querySelectorAll('ytd-live-chat-frame').forEach(defer);
        },
        {
          selector: 'ytd-live-chat-frame, ytd-live-chat-frame iframe',
          childList: true,
          attributes: true,
          attributeFilter: ['src', 'expanded'],
          subtree: true,
        }
      );
      ctx.onDispose(() => coordinator.unsubscribe?.(subId));
    }

    // Opening the panel is a user click; restore on the next task so YouTube's
    // own handler has already flipped the frame's state.
    ctx.listen(document, 'click', () => ctx.timeout(() => isOpen() && restore(), 0), {
      passive: true,
      capture: true,
    });
    ctx.onDispose(restore);
  };

  /** @type {Array<{ sync: () => void } | null>} */
  const features = PARTS.map(
    part =>
      window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
        id: part.id,
        routes: part.routes,
        when: () => masterOn() && partOn(part.setting),
        start(/** @type {YouTubePlusFeatureContext} */ ctx) {
          if (part.styleId) {
            const css = /** @type {Record<string, string>} */ (CSS)[part.routeKey];
            if (css) ctx.style(part.styleId, css);
          } else {
            setupLazyChat(ctx);
          }
        },
      }) || null
  );

  const syncAll = () => {
    for (const feature of features) feature?.sync();
  };

  // The parts carry no settingsKey of their own (their `when` gates both the
  // master switch and their own toggle), so re-sync on every relevant change.
  for (const key of [MASTER_KEY, ...PARTS.map(part => part.setting)]) {
    window.YouTubePlusSettingsStore?.subscribe?.(key, syncAll);
  }

  window.YouTubePlusPerformanceMode = /** @type {YouTubePlusPerformanceMode} */ ({});
  U?.exposeTestHooks?.(window.YouTubePlusPerformanceMode, {
    MASTER_KEY,
    PARTS,
    CSS,
    masterOn,
    partOn,
    syncAll,
  });

  U?.onDomReady?.(syncAll);
})();
