/**
 * Play All on m.youtube.com: the mobile host picks the mobile chip bar and
 * navigates with a full page load.
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://m.youtube.com/@channel/videos"}
 */

function loadChain() {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/event-delegation.js');
  require('../src/i18n.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
  require('../src/mutation-coordinator.js');
  require('../src/playall.js');
}

describe('playall on m.youtube.com', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    loadChain();
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    window.YouTubePlusDesignSystem?.StyleManager?.clear?.();
  });

  const hooks = () => window.YouTubePlusPlayall.testHooks;

  test('the mount target is the mobile chip bar', () => {
    document.body.innerHTML = `
      <ytm-feed-filter-chip-bar-renderer>
        <div class="chip-bar-contents"></div>
      </ytm-feed-filter-chip-bar-renderer>
    `;
    const mount = hooks().resolveMountTarget_(0);
    expect(mount?.parent.className).toBe('chip-bar-contents');
  });

  test('redirect loads the watch page instead of clicking a playlist endpoint', () => {
    document.body.innerHTML =
      '<ytd-playlist-panel-renderer><div id="items"></div></ytd-playlist-panel-renderer>';
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');
    const navigate = jest
      .spyOn(window.YouTubeUtils, 'navigateTo')
      .mockImplementation(() => undefined);
    hooks().redirect('v123', 'PL123', 'random');
    expect(navigate).toHaveBeenCalledWith('/watch?v=v123&list=PL123&ytp-random=random');
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
    navigate.mockRestore();
  });
});
