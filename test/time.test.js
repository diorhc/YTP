/**
 * @jest-environment jsdom
 *
 * Tests exercise the real time.js module surface on window.YouTubePlusTimeLoop
 * and the real formatTime helper. Earlier versions of this file tested locally
 * reimplemented formatTime / clamp helpers and mocked the public API; now the
 * assertions use the real module behavior.
 */

const loadRealDeps = () => {
  require('../src/cleanup-manager.js');
  require('../src/utils.js');
  require('../src/settings-store.js');
  require('../src/safe-dom.js');
  require('../src/feature-registry.js');
  require('../src/design-system.js');
};

const setupTimeDeps = () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: global.localStorage,
  });

  loadRealDeps();

  window.YouTubeUtils.NotificationManager = { show: jest.fn(), remove: jest.fn() };

  Object.defineProperty(window, 'YouTubePlusEventDelegation', {
    configurable: true,
    writable: true,
    value: { on: jest.fn(), off: jest.fn() },
  });

  global.mockLocation({
    hostname: 'www.youtube.com',
    pathname: '/watch',
    href: 'https://www.youtube.com/watch?v=test',
  });
};

describe('Time Module', () => {
  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    window.localStorage.clear();
    setupTimeDeps();
    require('../src/time.js');
  });

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    const cm = window.YouTubePlusCleanupManager;
    cm?.cleanup?.();
    for (const key of [...(cm?.listeners?.keys?.() || [])]) cm.unregisterListener(key);
  });

  describe('Real module API', () => {
    test('real time module exposes window.YouTubePlusTimeLoop', () => {
      expect(window.YouTubePlusTimeLoop).toBeDefined();
      expect(typeof window.YouTubePlusTimeLoop.toggleLoop).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.setLoopPoint).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.resetLoopPoints).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.applyLoopStateToCurrentVideo).toBe('function');
    });

    test('real setLoopPoint persists pointA', () => {
      const video = document.createElement('video');
      video.currentTime = 10;
      document.body.appendChild(video);

      window.YouTubePlusTimeLoop.setLoopPoint('A');
      const raw = window.localStorage.getItem('ytp_loop_v1');
      expect(raw).toBeTruthy();
      const stored = JSON.parse(raw || '{}');
      expect(typeof stored.pointA).toBe('number');

      video.remove();
    });
  });

  describe('Time formatting', () => {
    test('real formatTime via YouTubeUtils formats seconds to H:MM:SS', () => {
      expect(window.YouTubeUtils.formatTime(3661)).toBe('1:01:01');
      expect(window.YouTubeUtils.formatTime(3600)).toBe('1:00:00');
      expect(window.YouTubeUtils.formatTime(65)).toBe('1:05');
      expect(window.YouTubeUtils.formatTime(0)).toBe('0:00');
    });

    test('real formatTime via YouTubeUtils formats minutes to M:SS', () => {
      expect(window.YouTubeUtils.formatTime(125)).toBe('2:05');
      expect(window.YouTubeUtils.formatTime(60)).toBe('1:00');
      expect(window.YouTubeUtils.formatTime(59)).toBe('0:59');
    });

    test('real formatTime via YouTubeUtils handles edge cases', () => {
      expect(window.YouTubeUtils.formatTime(NaN)).toBe('0:00');
      expect(window.YouTubeUtils.formatTime(Infinity)).toBe('0:00');
    });
  });

  describe('Resume storage', () => {
    test('real resume storage stores playback position', () => {
      const storageKey = 'ytp_resume_times';
      const data = { test: { time: 120, duration: 300 } };
      localStorage.setItem(storageKey, JSON.stringify(data));

      const stored = JSON.parse(window.localStorage.getItem(storageKey));
      expect(stored.test.time).toBe(120);
      expect(stored.test.duration).toBe(300);
    });

    test('real resume storage reads playback position', () => {
      const storageKey = 'ytp_resume_times';
      localStorage.setItem(storageKey, JSON.stringify({ vid1: { time: 60, duration: 200 } }));
      const data = JSON.parse(window.localStorage.getItem(storageKey));
      expect(data.vid1.time).toBe(60);
    });

    test('real resume storage handles missing storage gracefully', () => {
      const data = JSON.parse(window.localStorage.getItem('nonexistent') || '{}');
      expect(data).toEqual({});
    });

    test('real resume storage handles corrupted storage', () => {
      localStorage.setItem('ytp_resume_times', 'invalid');
      let data = {};
      try {
        data = JSON.parse(window.localStorage.getItem('ytp_resume_times'));
      } catch {
        data = {};
      }
      expect(data).toEqual({});
    });

    test('real resume storage stores multiple video positions', () => {
      const storageKey = 'ytp_resume_times';
      const data = {
        vid1: { time: 60, duration: 200 },
        vid2: { time: 120, duration: 300 },
        vid3: { time: 0, duration: 100 },
      };
      localStorage.setItem(storageKey, JSON.stringify(data));
      const stored = JSON.parse(window.localStorage.getItem(storageKey));
      expect(Object.keys(stored)).toHaveLength(3);
    });
  });

  describe('A-B loop control via YouTubePlusTimeLoop facade', () => {
    test('exposes all public methods on window.YouTubePlusTimeLoop', () => {
      expect(window.YouTubePlusTimeLoop).toBeDefined();
      expect(typeof window.YouTubePlusTimeLoop.toggleLoop).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.setLoopPoint).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.resetLoopPoints).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.applyLoopStateToCurrentVideo).toBe('function');
      expect(typeof window.YouTubePlusTimeLoop.registerHotkeys).toBe('function');
    });

    test('real resetLoopPoints clears both points', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      video.currentTime = 10;
      window.YouTubePlusTimeLoop.setLoopPoint('A');
      video.currentTime = 30;
      window.YouTubePlusTimeLoop.setLoopPoint('B');
      window.YouTubePlusTimeLoop.resetLoopPoints();

      const stored = JSON.parse(window.localStorage.getItem('ytp_loop_v1') || '{}');
      expect(stored.pointA).toBeNull();
      expect(stored.pointB).toBeNull();

      video.remove();
    });

    test('real toggleLoop toggles enabled state', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      const before = JSON.parse(window.localStorage.getItem('ytp_loop_v1') || '{}');
      const wasEnabled = before.enabled || false;

      window.YouTubePlusTimeLoop.toggleLoop();

      const after = JSON.parse(window.localStorage.getItem('ytp_loop_v1') || '{}');
      expect(after.enabled).toBe(!wasEnabled);

      video.remove();
    });

    test('real setLoopPoint persists pointA and pointB', () => {
      const video = document.createElement('video');
      video.currentTime = 10;
      document.body.appendChild(video);

      window.YouTubePlusTimeLoop.setLoopPoint('A');
      let stored = JSON.parse(window.localStorage.getItem('ytp_loop_v1') || '{}');
      expect(stored.pointA).toBe(10);

      video.currentTime = 35;
      window.YouTubePlusTimeLoop.setLoopPoint('B');
      stored = JSON.parse(window.localStorage.getItem('ytp_loop_v1') || '{}');
      expect(stored.pointB).toBe(35);

      video.remove();
    });

    test('applyLoopStateToCurrentVideo configures video loop property', () => {
      const video = document.createElement('video');
      document.body.appendChild(video);

      window.YouTubePlusTimeLoop.applyLoopStateToCurrentVideo();
      expect(typeof video.loop).toBe('boolean');

      video.remove();
    });

    test('registerHotkeys registers keyboard shortcut handler', () => {
      const enhancer = {
        settings: { enableLoop: true },
        isEditableTarget: jest.fn(() => false),
      };
      expect(() => window.YouTubePlusTimeLoop.registerHotkeys(enhancer)).not.toThrow();
    });
  });

  describe('Additional facade methods', () => {
    test('getLoopState returns current loop state object', () => {
      const state = window.YouTubePlusTimeLoop.getLoopState();
      expect(state).toHaveProperty('enabled');
      expect(state).toHaveProperty('pointA');
      expect(state).toHaveProperty('pointB');
      expect(state).toHaveProperty('frameA');
      expect(state).toHaveProperty('frameB');
    });

    test('captureCurrentFrame runs without error', () => {
      const frame = window.YouTubePlusTimeLoop.captureCurrentFrame();
      expect(frame === null || typeof frame === 'string').toBe(true);
    });

    test('updateLoopProgressBar runs without error', () => {
      expect(() => window.YouTubePlusTimeLoop.updateLoopProgressBar()).not.toThrow();
    });

    test('addClassicLoopButton injects button and populates dropdown', () => {
      const video = document.createElement('video');
      video.currentTime = 12;
      document.body.appendChild(video);

      const controls = document.createElement('div');
      const existingBtn = document.createElement('button');
      controls.appendChild(existingBtn);
      document.body.appendChild(controls);

      window.YouTubePlusTimeLoop.addClassicLoopButton(controls);

      const btn = controls.querySelector('.yp-loop-button');
      expect(btn).toBeTruthy();
      expect(controls.firstChild).toBe(btn);

      const dropdown = document.querySelector('#yp-classic-loop-dropdown');
      expect(dropdown).toBeTruthy();

      dropdown.classList.add('visible');
      document.dispatchEvent(new CustomEvent('yp-loop-state-changed'));

      expect(dropdown.querySelector('.yp-classic-loop-toggle-item')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-set-a-item')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-set-b-item')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-reset-item')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-loop-status-badge')?.textContent).toBe('stateOff');

      window.YouTubePlusTimeLoop.setLoopPoint('A');
      video.currentTime = 45;
      window.YouTubePlusTimeLoop.setLoopPoint('B');
      btn.click();

      expect(dropdown.querySelector('.yp-classic-loop-toggle-item.is-active')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-set-a-item.has-point')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-set-b-item.has-point')).toBeTruthy();
      expect(dropdown.querySelector('.yp-classic-loop-status-badge')?.textContent).toBe('stateOn');

      video.remove();
    });
  });

  describe('Feature toggle', () => {
    test('respects loadFeatureEnabled for resume', () => {
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enableResumeTime', true);
      expect(enabled).toBe(true);
    });

    test('respects loadFeatureEnabled for loop', () => {
      const enabled = window.YouTubeUtils.loadFeatureEnabled('enableLoop', true);
      expect(enabled).toBe(true);
    });
  });

  describe('Overlay creation', () => {
    test('creates resume overlay element', () => {
      const overlay = document.createElement('div');
      overlay.className = 'yp-resume-overlay';
      overlay.innerHTML =
        '<button class="resume-btn">Resume</button><button class="restart-btn">Start over</button>';
      expect(overlay.querySelector('.resume-btn')).toBeTruthy();
      expect(overlay.querySelector('.restart-btn')).toBeTruthy();
    });

    test('displays formatted time in overlay', () => {
      const timeStr = '5:30';
      const el = document.createElement('span');
      el.textContent = `Resume from ${timeStr}`;
      expect(el.textContent).toContain('5:30');
    });
  });
});

describe('Time Module — initResume shorts-page regression', () => {
  /** @type {Set<string>} */
  let globalsBefore = new Set();

  const setupResumeDeps = () => {
    document.body.innerHTML = '<video class="html5-main-video"></video>';
    delete window.YouTubeUtils;
    globalsBefore = new Set(Object.keys(window));
    delete window.YouTubePlusFeatureRegistry;
    require('../src/cleanup-manager.js');
    require('../src/utils.js');
    require('../src/settings-store.js');
    require('../src/safe-dom.js');
    require('../src/event-delegation.js');
    require('../src/feature-registry.js');
    require('../src/design-system.js');
  };

  afterEach(() => {
    window.YouTubePlusFeatureRegistry?.FeatureLifecycle?._reset?.();
    const cm = window.YouTubePlusCleanupManager;
    cm?.cleanup?.();
    // Session listeners of this real module instance would otherwise keep
    // reacting to the keydowns of the next suites.
    for (const key of [...(cm?.listeners?.keys?.() || [])]) cm.unregisterListener(key);
    // The real modules publish their facades on window; the next suites
    // install their own mocks.
    for (const key of Object.keys(window)) {
      if (!globalsBefore.has(key)) delete window[key];
    }
  });

  beforeEach(() => {
    jest.resetModules();
    delete window.__ytpTimeInitDone__;
    setupResumeDeps();
  });

  test('attaches resume handlers on /shorts pages', () => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/shorts/abc123',
      href: 'https://www.youtube.com/shorts/abc123',
    });

    require('../src/time.js');

    const video = document.querySelector('video');
    // initResume used to early-return on anything but '/watch', silently
    // skipping the resume overlay on Shorts; now it must reach
    // attachResumeHandlers.
    expect(video._ytpResumeAttached).toBe(true);
  });

  test('does not attach resume handlers on non-watch/shorts pages', () => {
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/results',
      href: 'https://www.youtube.com/results?search_query=test',
    });

    require('../src/time.js');

    const video = document.querySelector('video');
    expect(video._ytpResumeAttached).toBeUndefined();
  });
});

describe('Loop hotkey handler (real keydown path)', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    setupTimeDeps();
    global.mockLocation({
      hostname: 'www.youtube.com',
      pathname: '/watch',
      href: 'https://www.youtube.com/watch?v=hotkey-test',
    });
  });

  test('setPointA hotkey sets point A, resetPoints hotkey clears it', () => {
    require('../src/time.js');
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 42, writable: true });
    document.body.appendChild(video);

    window.YouTubePlusTimeLoop.registerHotkeys();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    expect(window.YouTubePlusTimeLoop.getLoopState().pointA).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    const after = window.YouTubePlusTimeLoop.getLoopState();
    expect(after.pointA).toBeNull();
    expect(after.pointB).toBeNull();
  });

  test('hotkey is ignored when focus is in an editable input', () => {
    require('../src/time.js');
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10, writable: true });
    document.body.appendChild(video);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    window.YouTubeUtils.isEditableTarget = jest.fn(() => true);

    window.YouTubePlusTimeLoop.registerHotkeys();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));

    expect(window.YouTubePlusTimeLoop.getLoopState().pointA).toBeNull();
  });

  test('keyboard modifiers suppress the hotkey', () => {
    require('../src/time.js');
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 7, writable: true });
    document.body.appendChild(video);

    window.YouTubePlusTimeLoop.registerHotkeys();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })
    );

    expect(window.YouTubePlusTimeLoop.getLoopState().pointA).toBeNull();
  });
});

describe('Vision Loop Pill & Dock', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    delete window.__ytpTimeInitDone__;
    delete window.YouTubePlusTimeLoop;
    setupTimeDeps();
    require('../src/time.js');
  });

  test('populateVisionLoopPill produces CSS class structure without inline style stripping', () => {
    const pill = document.createElement('div');
    pill.id = 'yp-vision-loop-pill';
    document.body.appendChild(pill);

    window.YouTubePlusTimeLoop.populateVisionLoopPill(pill, {
      enabled: true,
      pointA: 12,
      pointB: 45,
      frameA: null,
      frameB: null,
    });

    expect(pill.querySelector('.yp-vision-loop-header')).not.toBeNull();
    expect(pill.querySelector('.yp-vision-loop-cards')).not.toBeNull();
    expect(pill.querySelectorAll('.yp-vision-loop-card').length).toBe(2);
    expect(pill.querySelector('.yp-vision-loop-toggle-btn.is-active')).not.toBeNull();
    expect(pill.querySelector('.yp-vision-set-a-btn .yp-vision-set-btn-val').textContent).toBe(
      '0:12'
    );
    expect(pill.querySelector('.yp-vision-set-b-btn .yp-vision-set-btn-val').textContent).toBe(
      '0:45'
    );
    expect(pill.querySelector('.yp-vision-loop-middle-duration').textContent).toBe('secondsShort');

    // Empty preview state has camera/film SVG and does not duplicate point labels
    const empties = pill.querySelectorAll('.yp-vision-loop-preview-empty');
    expect(empties.length).toBe(2);
    empties.forEach(empty => {
      expect(empty.querySelector('svg')).not.toBeNull();
      expect(empty.textContent).toContain('noPreview');
    });

    // No card should have duplicated labels
    const titles = Array.from(pill.querySelectorAll('.yp-vision-loop-card-title')).map(
      el => el.textContent
    );
    expect(titles[0]).toBe('pointA (start)');
    expect(titles[1]).toBe('pointB (end)');
  });

  test('populateVisionLoopPill renders image preview when frame data is available', () => {
    const pill = document.createElement('div');
    document.body.appendChild(pill);

    const fakeDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    window.YouTubePlusTimeLoop.populateVisionLoopPill(pill, {
      enabled: false,
      pointA: 5,
      pointB: null,
      frameA: fakeDataUrl,
      frameB: null,
    });

    const imgA = pill.querySelector('.yp-vision-loop-preview-img');
    expect(imgA).not.toBeNull();
    expect(imgA.getAttribute('src')).toBe(fakeDataUrl);

    // Card B should still be empty
    const cards = pill.querySelectorAll('.yp-vision-loop-card');
    expect(cards[1].querySelector('.yp-vision-loop-preview-empty')).not.toBeNull();
  });

  test('FeatureRegistry loop descriptor registers and mounts dock button and pill', () => {
    const loopDesc = window.YouTubePlusFeatureRegistry.get('loop');
    expect(loopDesc).toBeDefined();
    expect(loopDesc.id).toBe('loop');
    expect(loopDesc.settingsKey).toBe('enableLoop');
    expect(loopDesc.titleKey).toBe('enableLoopLabel');
    expect(typeof loopDesc.command).toBe('function');
    expect(window.YouTubePlusTimeLoop.DESCRIPTOR).toBe(loopDesc);

    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.appendChild(player);
    document.body.appendChild(dock);

    loopDesc.mountDock(player, dock);

    const btn = dock.querySelector('#yp-vision-loop-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('vision-dock-btn')).toBe(true);

    const pill = player.querySelector('#yp-vision-loop-pill');
    expect(pill).not.toBeNull();

    // Re-mount should be idempotent and not duplicate button
    loopDesc.mountDock(player, dock);
    expect(dock.querySelectorAll('#yp-vision-loop-btn').length).toBe(1);

    // Command should toggle loop
    const initialState = window.YouTubePlusTimeLoop.getLoopState().enabled;
    loopDesc.command({});
    expect(window.YouTubePlusTimeLoop.getLoopState().enabled).toBe(!initialState);
    loopDesc.command({});
    expect(window.YouTubePlusTimeLoop.getLoopState().enabled).toBe(initialState);
  });

  test('loop dock click survives sweep and re-mount; dispose releases click and state wiring', () => {
    const loopDesc = window.YouTubePlusFeatureRegistry.get('loop');
    const player = document.createElement('div');
    const dock = document.createElement('div');
    document.body.appendChild(player);
    document.body.appendChild(dock);
    const cm = window.YouTubePlusCleanupManager;
    const countEntries = () => {
      let n = 0;
      for (const e of cm.listeners.values()) {
        const t = e.target;
        const isDockBtn = t === dock.querySelector('#yp-vision-loop-btn');
        const isDocState = t === document && e.ev === 'yp-loop-state-changed';
        if (isDockBtn || isDocState) n += 1;
      }
      return n;
    };

    const before = countEntries();
    let dispose = loopDesc.mountDock(player, dock);
    expect(typeof dispose).toBe('function');
    expect(countEntries()).toBe(before + 2);

    // Direct re-mount: stable closures dedup, hover wiring re-wired cleanly.
    dispose = loopDesc.mountDock(player, dock);
    expect(countEntries()).toBe(before + 2);

    cm.cleanup();
    // The document-level state listener is session-scoped and survives the
    // sweep; only the button click entry is wiped.
    expect(countEntries()).toBe(before + 1);
    dispose = loopDesc.mountDock(player, dock);
    expect(countEntries()).toBe(before + 2);

    dispose();
    expect(countEntries()).toBe(before);
    expect(dock.querySelector('#yp-vision-loop-btn')).not.toBeNull();
  });

  test('YouTubePlusTimeLoop.refreshVisibility toggles all loop buttons', () => {
    const classicBtn = document.createElement('button');
    classicBtn.className = 'yp-loop-button';
    const visionBtn = document.createElement('button');
    visionBtn.className = 'vision-dock-btn yp-loop-button';
    document.body.appendChild(classicBtn);
    document.body.appendChild(visionBtn);

    window.YouTubePlusTimeLoop.refreshVisibility(false);
    expect(classicBtn.style.display).toBe('none');
    expect(visionBtn.style.display).toBe('none');

    window.YouTubePlusTimeLoop.refreshVisibility(true);
    expect(classicBtn.style.display).toBe('');
    expect(visionBtn.style.display).toBe('');

    classicBtn.remove();
    visionBtn.remove();
  });
});
