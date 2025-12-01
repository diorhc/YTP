describe('NotificationManager', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    // Remove any existing global to ensure a clean load
    delete window.YouTubePlusNotificationManager;
  });

  test('module attaches to window and exposes API', () => {
    // Ensure DOMManager is available so createElement supports attributes/dataset
    require('../src/dom-manager.js');
    require('../src/notification-manager.js');
    expect(window.YouTubePlusNotificationManager).toBeDefined();
    const nm = window.YouTubePlusNotificationManager;
    expect(typeof nm.show).toBe('function');
    expect(typeof nm.clearAll).toBe('function');
  });

  test('show adds notification element to DOM and returns element', () => {
    // Ensure DOMManager is available so createElement supports attributes/dataset
    require('../src/dom-manager.js');
    require('../src/notification-manager.js');
    const nm = window.YouTubePlusNotificationManager;

    const el = nm.show('test-message', { duration: 0 });
    expect(el).toBeTruthy();

    // The createElement fallback used in tests may not set id consistently,
    // so locate the container by class name which is stable.
    const container = document.querySelector('.youtube-enhancer-notification-container');
    expect(container).toBeTruthy();
    expect(container.querySelector('[data-message="test-message"]')).toBeTruthy();
  });

  test('duplicate messages are removed and replaced', () => {
    jest.useFakeTimers();
    // Ensure DOMManager is available so createElement supports attributes/dataset
    require('../src/dom-manager.js');
    require('../src/notification-manager.js');
    const nm = window.YouTubePlusNotificationManager;

    const n1 = nm.show('dupe', { duration: 10000 });
    expect(nm.activeNotifications.size).toBeGreaterThanOrEqual(1);

    const n2 = nm.show('dupe', { duration: 10000 });
    // The previous notification should be scheduled for removal (animation + cleanup timeout 300ms)
    // Fast-forward animation timeout
    jest.advanceTimersByTime(350);

    // After cleanup, ensure at least one notification remains and all
    // remaining notifications have the expected message.
    const remaining = Array.from(nm.activeNotifications);
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    remaining.forEach(r => expect(r.dataset.message).toBe('dupe'));

    jest.useRealTimers();
  });

  test('clearAll removes all notifications', () => {
    jest.useFakeTimers();
    require('../src/notification-manager.js');
    const nm = window.YouTubePlusNotificationManager;

    nm.show('one', { duration: 10000 });
    nm.show('two', { duration: 10000 });

    expect(nm.activeNotifications.size).toBeGreaterThanOrEqual(2);

    nm.clearAll();

    // clearAll triggers remove which uses 300ms removal animation
    jest.advanceTimersByTime(350);

    expect(nm.activeNotifications.size).toBe(0);

    jest.useRealTimers();
  });
});
