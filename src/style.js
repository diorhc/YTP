(function () {
  try {
    const host = typeof location === 'undefined' ? '' : location.hostname;
    if (!host) return;
    // Only apply on youtube domains
    if (!/(^|\.)youtube\.com$/.test(host) && !/\.youtube\.google/.test(host)) return;

    const css = `
/* yt-thumbnail hover */
#inline-preview-player {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 1s !important; transform: scale(1) !important;}
#video-preview-container:has(#inline-preview-player) {transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important; border-radius: 1.2em !important; overflow: hidden !important; transform: scale(1) !important;}
#video-preview-container:has(#inline-preview-player):hover {transform: scale(1.25) !important; box-shadow: #0008 0px 0px 60px !important; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) 2s !important;}
ytd-app #content {opacity: 1 !important; transition: opacity 0.3s ease-in-out !important;}
ytd-app:has(#video-preview-container:hover) #content {opacity: 0.5 !important; transition: opacity 4s ease-in-out 1s !important;}
/* yt-Immersive search */
#page-manager, yt-searchbox {transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.35) !important;}
#masthead yt-searchbox button[aria-label="Search"] {display: none !important;}
.ytSearchboxComponentInputBox {border-radius: 2em !important;}
yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) {position: relative !important; left: 0vw !important; top: -30vh !important; height: 40px !important; max-width: 600px !important; transform: scale(1) !important;}
@media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) { height: 60px !important; max-width: 700px !important; transform: scale(1.1) !important;}
}
yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox, yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: #fffb !important; box-shadow: black 0 0 30px !important;}
@media (prefers-color-scheme: dark) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) .ytSearchboxComponentInputBox, yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {background-color: #000b !important;}}
yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 10px !important;}
@media only screen and (min-width: 1400px) {yt-searchbox:has(.ytSearchboxComponentInputBoxHasFocus) #i0 {margin-top: 30px !important;}}
.ytd-masthead #center:has(.ytSearchboxComponentInputBoxHasFocus) {height: 100vh !important; width: 100vw !important; left: 0 !important; top: 0 !important; position: fixed !important; justify-content: center !important; align-items: center !important;}
#content:has(.ytSearchboxComponentInputBoxHasFocus) #page-manager {filter: blur(20px) !important; transform: scale(1.05) !important;}
/* ===== No voice search button ===== */
#voice-search-button {display: none !important;}
/* ===== YouTube Transparent header (from styles.json) ===== */
#masthead-container {#background.ytd-masthead {background-color: #00000000 !important;}}
/* ===== Toggle side guide - полностью убирает боковую панель ===== */
ytd-mini-guide-renderer, [theater=""] #contentContainer::after {display: none !important;}
tp-yt-app-drawer > #contentContainer:not([opened=""]), #contentContainer:not([opened=""]) #guide-content, ytd-mini-guide-renderer, ytd-mini-guide-entry-renderer {background-color: var(--yt-spec-text-primary-inverse) !important; background: var(--yt-spec-text-primary-inverse) !important;}
#content:not(:has(#contentContainer[opened=""])) #page-manager {margin-left: 0 !important;}
ytd-app:not([guide-persistent-and-visible=""]) tp-yt-app-drawer > #contentContainer {background-color: var(--yt-spec-text-primary-inverse) !important;}
ytd-alert-with-button-renderer {align-items: center !important; justify-content: center !important;}
/* ===== Clean side guide - убирает YouTube Premium, Sports, Settings и footer из guide ===== */
ytd-guide-section-renderer:has([title="YouTube Premium"]),
ytd-guide-renderer #footer {display: none !important;}
ytd-guide-section-renderer, ytd-guide-collapsible-section-entry-renderer {border: none !important;}
`;

    const ID = 'ytp-zen-features-style';
    if (document.getElementById(ID)) return;
    const style = document.createElement('style');
    style.id = ID;
    style.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(style);
  } catch (err) {
    // fail silently; don't break host page
    console.error('zen-youtube-features injection failed', err);
  }
})();
