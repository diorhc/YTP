/**
 * Unit tests for src/main.js outer boot path (the userscript-context IIFE
 * that orchestrates tabview injection).
 *
 * Tests the idempotency guard, GM_addElement invocation, StyleManager
 * registration, and the settings-updated event handler.
 *
 * The inner `executionScript` (page-context string) is intentionally not
 * tested here — it's 6000+ lines that depends on YouTube's custom element
 * prototypes and runs inside a page-context <script> element. The outer
 * boot IIFE is the only part that can be exercised in jsdom isolation.
 */

describe("main.js outer boot path", () => {
  /** @type {jest.Mock} */
  let gmAddElement;

  beforeEach(() => {
    jest.resetModules();
    // Mock Tampermonkey GM_addElement — used by main.js to inject the
    // page-context executionScript as a <script> element.
    gmAddElement = jest.fn();
    Object.defineProperty(globalThis, "GM_addElement", {
      configurable: true,
      writable: true,
      value: gmAddElement,
    });

    // Mock YouTubePlusDesignSystem with a StyleManager
    const styleManager = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    Object.defineProperty(window, "YouTubePlusDesignSystem", {
      configurable: true,
      writable: true,
      value: { StyleManager: styleManager },
    });

    // Mock YouTubeUtils with loadFeatureEnabled
    Object.defineProperty(window, "YouTubeUtils", {
      configurable: true,
      writable: true,
      value: {
        loadFeatureEnabled: jest.fn(() => true),
        logger: null,
      },
    });

    // Ensure document.documentElement exists (jsdom may not set it)
    if (!document.documentElement) {
      const html = document.createElement("html");
      document.appendChild(html);
    }

    // Clear idempotency flags
    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;
  });

  afterEach(() => {
    delete globalThis.GM_addElement;
    delete window.YouTubePlusDesignSystem;
    delete window.YouTubeUtils;
    delete window.__ytpMainBootDone__;
    delete window.__ytpMainExecDone__;
  });

  test("sets __ytpMainBootDone__ idempotency flag on first load", () => {
    require("../src/main.js");
    expect(window.__ytpMainBootDone__).toBe(true);
  });

  test("idempotency guard prevents re-injection on second load", () => {
    // First load
    require("../src/main.js");
    const firstCallCount = gmAddElement.mock.calls.length;

    // Second load — should be a no-op due to __ytpMainBootDone__
    jest.resetModules();
    // Re-set the flag since resetModules resets the require cache but
    // not the window state
    window.__ytpMainBootDone__ = true;
    require("../src/main.js");

    // GM_addElement should not have been called again
    expect(gmAddElement.mock.calls.length).toBe(firstCallCount);
  });

  test("injects executionScript via GM_addElement", () => {
    require("../src/main.js");

    expect(gmAddElement).toHaveBeenCalledTimes(1);
    const [parent, tag, attrs] = gmAddElement.mock.calls[0];
    expect(parent).toBe(document.head || document.documentElement);
    expect(tag).toBe("script");
    // The textContent should contain the serialized executionScript body
    expect(attrs.textContent).toContain("__ytpMainExecDone__");
    expect(attrs.textContent).toContain(
      "//# sourceURL=debug://tabview-youtube/tabview.execution.js",
    );
  });

  test("registers tabview CSS via StyleManager when enabled", () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require("../src/main.js");

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    expect(styleManager.add).toHaveBeenCalledWith(
      "yt-plus-tabview-core",
      expect.any(String),
    );
  });

  test("skips CSS registration when tabview is disabled", () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(false);
    require("../src/main.js");

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    expect(styleManager.add).not.toHaveBeenCalled();
  });

  test("registers youtube-plus-settings-updated event listener", () => {
    // Spy on addEventListener
    const addEventListenerSpy = jest.spyOn(window, "addEventListener");
    require("../src/main.js");

    // Should have registered the 'youtube-plus-settings-updated' handler
    const calls = addEventListenerSpy.mock.calls.filter(
      ([event]) => event === "youtube-plus-settings-updated",
    );
    expect(calls.length).toBe(1);
    addEventListenerSpy.mockRestore();
  });

  test("settings-updated handler adds CSS when tabview enabled", () => {
    require("../src/main.js");

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockClear();

    // Dispatch settings-updated with tabview enabled
    const event = new CustomEvent("youtube-plus-settings-updated", {
      detail: { enableTabview: true },
    });
    window.dispatchEvent(event);

    expect(styleManager.add).toHaveBeenCalledWith(
      "yt-plus-tabview-core",
      expect.any(String),
    );
  });

  test("settings-updated handler removes CSS when tabview disabled", () => {
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);
    require("../src/main.js");

    const styleManager = window.YouTubePlusDesignSystem.StyleManager;
    styleManager.add.mockClear();

    // Dispatch settings-updated with tabview disabled
    const event = new CustomEvent("youtube-plus-settings-updated", {
      detail: { enableTabview: false },
    });
    window.dispatchEvent(event);

    expect(styleManager.remove).toHaveBeenCalledWith("yt-plus-tabview-core");
  });

  test("handles missing YouTubePlusDesignSystem.StyleManager gracefully", () => {
    window.YouTubePlusDesignSystem = {};
    window.YouTubeUtils.loadFeatureEnabled.mockReturnValue(true);

    // Should not throw when StyleManager is missing
    expect(() => require("../src/main.js")).not.toThrow();
  });

  test("handles missing YouTubeUtils gracefully", () => {
    delete window.YouTubeUtils;

    // Should not throw when YouTubeUtils is missing
    expect(() => require("../src/main.js")).not.toThrow();
  });
});
