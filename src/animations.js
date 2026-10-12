// Animations runtime.
//
// Responsibility: smooth motion for YouTube's own UI (docs/DESIGN.md §6), as
//   one opt-in feature. CSS only: feed cards rise in on a scroll-driven
//   timeline, menus and dropdowns open from their anchor, buttons and chips
//   give press feedback. Nothing is observed and nothing runs while idle.
//   Off under prefers-reduced-motion (the CSS sits in a no-preference media
//   query) and while performance mode is on.
// Public surface: window.YouTubePlusAnimations (test hooks only).
(function () {
  const U = window.YouTubeUtils;

  const SETTING_KEY = 'enableAnimations';
  const PERFORMANCE_KEY = 'performanceMode';
  const STYLE_ID = 'yp-animations';

  /** @type {YouTubePlusRoute[]} */
  const ROUTES = ['home', 'feed', 'search', 'channel', 'playlist', 'watch', 'shorts', 'other'];

  const FEED_CARDS =
    'ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,' +
    'ytd-compact-video-renderer,ytd-playlist-renderer,ytd-channel-renderer,' +
    'ytd-reel-item-renderer,ytd-rich-section-renderer';

  const MENUS =
    'tp-yt-iron-dropdown,ytd-menu-popup-renderer,ytd-multi-page-menu-renderer,' +
    'yt-sheet-view-model,tp-yt-paper-listbox';

  const PRESSABLE =
    'yt-button-shape button,yt-chip-cloud-chip-renderer,ytd-toggle-button-renderer button,' +
    'ytd-guide-entry-renderer tp-yt-paper-item,ytd-mini-guide-entry-renderer';

  // Only transform and opacity animate (DESIGN.md §3.4). Enter uses the
  // decelerating curve; nothing loops.
  const CSS = `@media (prefers-reduced-motion:no-preference){
@supports (animation-timeline:view()){
:is(${FEED_CARDS}){animation:yp-anim-rise linear both;animation-timeline:view();animation-range:entry 0% entry 40%}
@keyframes yp-anim-rise{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
}
:is(${MENUS}){transition:opacity var(--yp-dur-3) var(--yp-ease-in),transform var(--yp-dur-3) var(--yp-ease-in),display var(--yp-dur-3) allow-discrete;transform-origin:top center}
@starting-style{:is(${MENUS}){opacity:0;transform:translateY(-6px) scale(.97)}}
:is(${PRESSABLE}){transition:transform var(--yp-dur-2) var(--yp-ease)}
:is(${PRESSABLE}):active{transform:scale(.97);transition-duration:var(--yp-dur-1)}
}`;

  const store = () => window.YouTubePlusSettingsStore;
  const performanceModeOn = () => store()?.get?.(PERFORMANCE_KEY) === true;

  const feature =
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?.define?.({
      id: 'animations',
      settingsKey: SETTING_KEY,
      routes: ROUTES,
      when: () => !performanceModeOn(),
      start(/** @type {YouTubePlusFeatureContext} */ ctx) {
        ctx.style(STYLE_ID, CSS);
      },
    }) || null;

  // Performance mode wins: switching it on stops the animations at once.
  store()?.subscribe?.(PERFORMANCE_KEY, () => feature?.sync());
  U?.onDomReady?.(() => feature?.sync());

  window.YouTubePlusAnimations = /** @type {YouTubePlusAnimations} */ ({});
  U?.exposeTestHooks?.(window.YouTubePlusAnimations, {
    SETTING_KEY,
    STYLE_ID,
    ROUTES,
    CSS,
    performanceModeOn,
  });
})();
