/**
 * Play All (src/playall.js): the observer-frame gate must be freed when the
 * runtime reset cancels a live frame, so a grid mutation after the runtime is
 * re-armed still drives a rebuild.
 * @jest-environment jsdom
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
}

const lifecycle = () => window.YouTubePlusFeatureRegistry.FeatureLifecycle;
const store = () => window.YouTubePlusSettingsStore;
const hooks = () => window.YouTubePlusPlayall?.testHooks;
const button = () => document.querySelector('.yp-play-all-btn');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

/** Channel-style page with a chip bar + grid and channel meta. */
function mountChannelPage() {
  document.head.innerHTML =
    '<meta itemprop="channelId" content="UC1234567890123456789012">' +
    '<link rel="canonical" href="https://www.youtube.com/@channel/videos">';
  const grid = document.createElement('ytd-rich-grid-renderer');
  const chipBar = document.createElement('chip-bar-view-model');
  chipBar.className = 'ytChipBarViewModelHost';
  grid.appendChild(chipBar);
  document.body.appendChild(grid);
  const app = document.createElement('ytd-app');
  app.appendChild(document.createElement('div'));
  document.body.appendChild(app);
}

const waitButton = async () => {
  for (let i = 0; i < 40; i++) {
    if (button()) return button();
    await wait(50);
  }
  return null;
};

describe('playall observer-frame gate across a runtime reset', () => {
  beforeEach(() => {
    jest.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    delete window.YouTubePlusPlayall;

    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/@channel/videos',
      href: 'https://www.youtube.com/@channel/videos',
    });

    mountChannelPage();
    loadChain();
    store().set('enablePlayAll', false);
    require('../src/playall.js');
  });

  afterEach(() => {
    lifecycle()?._reset?.();
  });

  test('a grid mutation after a reset still rebuilds the button', async () => {
    store().set('enablePlayAll', true);
    const first = await waitButton();
    expect(first).not.toBeNull();

    // The removal schedules observer work on the next coordinator flush;
    // awaiting one frame leaves that work pending, so the reset below cancels
    // a live frame rather than a spent one.
    first.remove();
    await nextFrame();
    hooks().cleanup();

    // Re-arm through the lifecycle so the runtime gets a fresh context.
    store().set('enablePlayAll', false);
    store().set('enablePlayAll', true);
    const second = await waitButton();
    expect(second).not.toBeNull();

    // The retry scheduler fires on a timer until it sees the button; let it
    // quiesce so only the mutation-driven path can rebuild below.
    await wait(300);
    second.remove();
    await wait(250);

    expect(button()).not.toBeNull();
  });
});
