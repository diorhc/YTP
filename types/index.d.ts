/**
 * YouTube+ Userscript: global type definitions
 *
 * Type surface for `window.*` properties installed by the
 * ~37 ES2020 modules concatenated into youtube.user.js. This file
 * is the single source of truth for the global namespace; the
 * legacy src/types.d.ts (which duplicated and diverged from this
 * file) has been removed.
 *
 * Conventions:
 *   - Interfaces use the runtime global name (YouTubeUtils, not
 *     YouTubeUtilsAPI) so `var X: X` declarations and `Window`
 *     property types all reference the same identifier.
 *   - Where two source files declare overlapping interfaces, the more
 *     specific definition wins.
 *   - Every interface that also appears on `Window` lives in one
 *     place. Property additions are made to the interface, not
 *     duplicated into the Window declaration.
 *   - Dynamic host objects are typed with the members the code reads;
 *     a caller that reaches a name outside that shape casts at the use site.
 */

export {};

declare global {
  /** Tabview page-realm tick function, shared across realms (main.js). */
  var nextBrowserTick:
    | (((callback: () => void) => void) & { version?: number })
    | undefined;

  // -------------------------------------------------------------------------
  // YouTubeUtils (utils.js): boot shorthand and module surface.
  // -------------------------------------------------------------------------

  interface CleanupManager {
    registerObserver<T extends MutationObserver | IntersectionObserver | ResizeObserver>(
      observer: T,
      el?: Element | null,
      opts?: { scope?: string }
    ): T;
    registerListener<E extends Event = Event>(
      target: EventTarget,
      ev: string,
      // Generic over the event so a handler typed for a narrower event stays
      // assignable; an unannotated handler contextually gets `Event`.
      fn: (event: E) => void,
      opts?: AddEventListenerOptions | boolean,
      // `'session'` survives per-navigation cleanup() sweeps (see
      // cleanup-manager.js isPersistentScope), the same contract as the
      // `{scope:'session'}` timer/observer opts.
      persistent?: boolean | 'session'
    ): symbol | null;
    registerInterval(
      id: ReturnType<typeof setInterval> | number,
      opts?: { scope?: 'page' | 'session' }
    ): ReturnType<typeof setInterval> | number;
    unregisterInterval?(id: ReturnType<typeof setInterval> | number): void;
    registerTimeout(
      id: ReturnType<typeof setTimeout> | number,
      opts?: { scope?: 'page' | 'session' }
    ): ReturnType<typeof setTimeout> | number;
    timeout(
      fn: () => void,
      ms: number,
      opts?: { scope?: 'page' | 'session' }
    ): ReturnType<typeof setTimeout> | number;
    unregisterTimeout?(id: ReturnType<typeof setTimeout> | number): void;
    registerAnimationFrame(id: number, opts?: { scope?: 'page' | 'session' }): number;
    unregisterAnimationFrame?(id: number): void;
    register(cb: () => void): void;
    unregister?(cb: () => void): void;
    unregisterObserver?(observer: MutationObserver | IntersectionObserver | ResizeObserver): void;
    unregisterListener?(key: symbol | null): void;
    cleanup(): void;
    disconnectForElement?(el: Element): void;
    disconnectSubtree?(root: Node): void;
    disconnectObserver?(observer: MutationObserver | IntersectionObserver | ResizeObserver): void;
    getListenerStats?(): { active: number; registeredTotal: number };
    onNavigateStart(cb: () => void): () => void;
    onNavigateFinish(cb: () => void): () => void;
    notifyNavigateStart(): void;
    notifyNavigateFinish(): void;
    observers: Set<MutationObserver | IntersectionObserver | ResizeObserver>;
    listeners: Map<
      symbol,
      {
        target: EventTarget;
        ev: string;
        fn: EventListenerOrEventListenerObject;
        opts?: AddEventListenerOptions | boolean;
      }
    >;
    intervals: Set<ReturnType<typeof setInterval>>;
    timeouts: Set<ReturnType<typeof setTimeout>>;
    animationFrames: Set<number>;
  }

  interface NotificationManagerAPI {
    show(
      message: string,
      options?: {
        duration?: number;
        position?: string | null;
        action?: { text: string; callback: () => void } | null;
        type?: string;
      }
    ): HTMLElement | null;
    remove(notification: HTMLElement): void;
  }

  interface StyleManagerAPI {
    styles: Map<string, string>;
    add(id: string, css: string): void;
    remove(id: string): void;
    clear(): void;
  }

  interface SettingsManagerAPI {
    settings: YoutubePlusSettings;
    load(): YoutubePlusSettings;
    save(settings: YoutubePlusSettings): void;
    get<T = unknown>(path: string, defaultValue?: T): T;
    set<T>(path: string, value: T): void;
  }

  // YoutubePlusSettings and StylesSettings are declared via JSDoc
  // in settings-helpers.js and re-exported here for global use.
  type YoutubePlusSettings = import('../src/settings-helpers.js').YoutubePlusSettings;
  type StylesSettings = import('../src/settings-helpers.js').StylesSettings;

  interface YouTubeUtils {
    logger?: {
      debug: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
      [key: string]: unknown;
    };
    /** Which host classes the bundle runs modules on (see the build prologue). */
    hostPolicy?: YouTubePlusHostPolicy;
    // ----- DOM helpers -----
    $: (selector: string, ctx?: Element | Document) => Element | null;
    $$: (selector: string, ctx?: Element | Document) => Element[];
    byId: (id: string) => Element | null;
    querySelector?: (selector: string, ctx?: Element | Document) => Element | null;
    querySelectorAll?: (selector: string, ctx?: Element | Document) => Element[];

    // ----- Module boot shorthand (see utils.js) -----
    helpers: {
      $: (selector: string, ctx?: Element | Document) => Element | null;
      $$: (selector: string, ctx?: Element | Document) => Element[];
      byId: (id: string) => Element | null;
      t: (key: string, params?: Record<string, string | number>) => string;
      logger: YouTubePlusLogger;
      createHTML: (...args: unknown[]) => string;
      debounce: <T extends (...args: unknown[]) => unknown>(fn: T, ms: number) => T;
      setTimeout_: typeof setTimeout;
    };

    safeExecute?: <T>(fn: () => T, fallback?: T) => T;
    safeExecuteAsync?: <T>(fn: () => Promise<T>, fallback?: T) => Promise<T>;
    isMobile?: () => boolean;
    getViewport?: () => { width: number; height: number };
    retryAsync?: <T>(fn: () => Promise<T>, retries?: number, delay?: number) => Promise<T>;

    // ----- Translation -----
    t: (key: string, params?: Record<string, string | number>) => string;
    /** "Is this key translated" probe (i18n.js). */
    hasTranslation?: (key: string) => boolean;
    /**
     * Timer wrapper used by time.js and basic.js for a
     * long-lived (>= 1s) setTimeout that should participate in the
     * central cleanupManager registry. The bare `setTimeout` is
     * kept as the safe fallback in callers; see `timeSetTimeout_`
     * in time.js, so a missing wrapper can never silently drop
     * the scheduled callback.
     */
    setTimeout_?: (handler: (...args: unknown[]) => void, ms?: number) => unknown;
    openSafe?: (rawUrl: string, target?: string) => boolean;
    onDomReady: (cb: () => void) => void;
    /** Publishes feature-internal test hooks on a facade when the test flag is on. */
    exposeTestHooks?: (facade: object, hooks: Record<string, unknown>) => void;

    // ----- Utilities -----
    debounce: <T extends (...args: never[]) => unknown>(
      fn: T,
      ms: number,
      options?: { leading?: boolean }
    ) => T & { cancel: () => void; destroy?: () => void };
    throttle: <T extends (...args: never[]) => unknown>(fn: T, limit: number) => T;
    createElement: (
      tag: string,
      props?: Record<string, unknown>,
      children?: (string | Node)[]
    ) => HTMLElement;
    waitForElement: (
      selector: string,
      timeout?: number,
      parent?: Element | Document
    ) => Promise<Element | null>;
    sanitizeHTML?: (html: string) => string;
    setSafeHTML: (element: Element, html: string, sanitize?: boolean) => void;
    confirmDialog: (options?: {
      message?: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }) => Promise<boolean>;
    renderTemplateClone: (container: Element, html: string | unknown) => void;
    escapeHTML: (input: string) => string;
    escapeHTMLAttribute?: (str: string) => string;
    isValidURL?: (url: string) => boolean;
    safeMerge?: (
      target: Record<string, unknown>,
      source: Record<string, unknown>
    ) => Record<string, unknown>;
    loadFeatureEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
    isWatchPage?: (urlLike?: string) => boolean;
    isShortsPage?: (urlLike?: string) => boolean;
    isChannelPage?: (urlLike?: string) => boolean;
    formatTime?: (seconds: number) => string;
    isEditableTarget?: (target: EventTarget | null | undefined) => boolean;
    isEditableActiveElement: (
      enhancer?: { isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null
    ) => boolean;
    registerListenerSafe?: (
      target: EventTarget,
      type: string,
      handler: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions | boolean | { owner?: HTMLElement; [key: string]: unknown }
    ) => unknown;
    createExperimentalNavClickHandler?: (attachSettingsHandler: () => void) => (e: Event) => void;
    createIsRelevantRoute: (options?: {
      watch?: boolean;
      shorts?: boolean;
      channel?: boolean;
      domain?: boolean;
      settingsModal?: boolean;
    }) => () => boolean;
    createWithErrorBoundary: (
      moduleName: string,
      logErrorFn?: (...args: unknown[]) => unknown
    ) => <T extends (...args: never[]) => unknown>(fn: T, context?: string) => T;
    createHTML: (html: string) => string;
    logError: (module: string, message: string, error: Error | unknown) => void;
    logSuppressed: (error: unknown, module: string, message?: string) => void;
    normalizeSuppressedError: (error: unknown) => Error;
    isStudioPage?: () => boolean;

    // ----- Settings modal detection (utils.js) -----
    isSettingsModalOpen: () => boolean;

    // ----- Route matching (utils.js) -----
    isYouTubeDomain: () => boolean;
    isMusicDomain: () => boolean;
    isStudioDomain: () => boolean;
    getHostname: () => string;
    isWatchRoute: () => boolean;
    isShortsRoute: () => boolean;
    isChannelRoute: () => boolean;
    getRoute: () => YouTubePlusRoute;

    // ----- Safe animation frame (utils.js) -----
    safeRequestAnimationFrame: (cb: FrameRequestCallback) => number;

    // ----- Runtime activation helpers (utils.js) -----
    whenRelevant: (config: {
      isRelevant: () => boolean;
      onEnter?: () => void;
      onLeave?: () => void;
      signals?: ReadonlyArray<string>;
      name?: string;
    }) => { readonly active: boolean; check: () => void; dispose: () => void };
    on: <E extends Event = Event>(
      target: EventTarget,
      event: string,
      handler: (event: E) => void,
      options?: AddEventListenerOptions | boolean
    ) => () => void;
    group: (...disposers: Array<() => void>) => () => void;
    onSectionActive: (
      sectionId: string,
      onEnter: () => void,
      onLeave?: () => void
    ) => { dispose: () => void };

    // ----- Video ID extraction (utils.js) -----
    getVideoIdFromUrl: (url: string) => string | null;
    getVideoIdFromLocation: () => string | null;
    getScriptVersion: () => string;
    /**
     * Page-realm window (Firefox `unsafeWindow`, Xray-unwrapped). Host globals
     * outside the DOM surface are reached through casts at the use site.
     */
    getPageWindow: () => Window & typeof globalThis;

    // ----- Shared style injection (utils.js) -----
    injectModuleStyles: (id: string, css: string, target?: Element) => void;

    /** Full page load of a URL. */
    navigateTo: (url: string) => void;

    // ----- Storage -----
    storage: {
      get<T = unknown>(key: string, defaultValue?: T): T;
      set(key: string, value: unknown): boolean;
      remove(key: string): void;
      has(key: string): boolean;
      clear(): void;
      getItem(k: string, def?: string | null): string | null;
      setItem(k: string, v: string): boolean;
      removeItem(k: string): void;
    };

    // ----- Caching / querying -----
    domCache?: YouTubeDOMCache;
    scopedCache?: unknown;
    selectors?: unknown;
    batchQuery?: (...args: unknown[]) => unknown;
    waitFor?: (...args: unknown[]) => unknown;

    // ----- i18n shortcut -----
    i18n?: YouTubePlusI18n;

    // ----- Observers / schedulers -----
    ObserverRegistry?: {
      track(key?: string, observer?: unknown): void;
      untrack(key?: string): void;
      loadFeatureEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
    };
    createRetryScheduler?: (
      opts: {
        check: () => boolean;
        maxAttempts?: number;
        interval?: number;
        onGiveUp?: () => void;
        label?: string;
      }
    ) => { stop: () => void } | null;
    createVisibilityAwareInterval?: (
      callback: () => void,
      delay: number
    ) => {
      stop: () => void;
      pause: () => void;
      resume: () => void;
      active: boolean;
    };

    // ----- Managers -----
    cleanupManager: CleanupManager;
    NotificationManager: NotificationManagerAPI;
    StyleManager: StyleManagerAPI;
    SettingsManager: SettingsManagerAPI;
    EventDelegator?: {
      delegate(
        parent: Element,
        selector: string,
        event: string,
        handler: (e: Event) => void
      ): () => void;
      clearFor(parent: Element): void;
      clearAll(): void;
    };

    // ----- Logger -----
    logger?: {
      debug: (...args: unknown[]) => void;
      info: (...args: unknown[]) => void;
      warn: (...args: unknown[]) => void;
      error: (...args: unknown[]) => void;
    };

    // ----- Settings key -----
    SETTINGS_KEY?: string;
    getLanguage: () => string;
  }

  // -------------------------------------------------------------------------
  // YouTubeErrorBoundary (error-boundary.js): owner.
  //   The same shape is also surfaced on YouTubePlusLogger as a
  //   back-compat bridge (see logger.js).
  // -------------------------------------------------------------------------

  interface YouTubeErrorBoundaryMethods {
    withErrorBoundary: (
      fn: (...args: never[]) => unknown,
      context?: string
    ) => (...args: never[]) => unknown;
    withAsyncErrorBoundary: (
      fn: (...args: never[]) => Promise<unknown>,
      context?: string
    ) => (...args: never[]) => Promise<unknown>;
    getErrorStats: () => {
      totalErrors: number;
      recentErrors: number;
      lastErrorTime: number;
      isRecovering: boolean;
      errorsByType: Record<string, number>;
    };
    clearErrors: () => void;
    logError: (error: Error, context?: Record<string, unknown>) => void;
    getErrorRate: () => number;
    config: Record<string, unknown>;
  }

  interface YouTubeErrorBoundary extends YouTubeErrorBoundaryMethods {}
  type YouTubePlusErrorBoundary = YouTubeErrorBoundary;

  // -------------------------------------------------------------------------
  // YouTubePerformance (performance.js)
  // -------------------------------------------------------------------------

  interface YouTubePerformance {
    mark(name: string): void;
    measure(name: string, startMark: string, endMark?: string): number;
    timeFunction: (name: string, fn: (...args: never[]) => unknown) => (...args: never[]) => unknown;
    timeAsyncFunction: (name: string, fn: (...args: never[]) => Promise<unknown>) => (...args: never[]) => Promise<unknown>;
    recordMetric(name: string, value: number, metadata?: Record<string, unknown>): void;
    getStats(metricName?: string): Record<string, unknown> | null;
    exportMetrics?(): string;
    exportToFile?(filename?: string): boolean;
    clearMetrics(): void;
    monitorMutations?(element: Element, name: string): MutationObserver | null;
    getPerformanceEntries?(type: string): PerformanceEntry[];
    getMemoryUsage?(): {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
      usedPercent: string;
    } | null;
    trackMemory?(): void;
    checkThresholds?(
      thresholds: Record<string, number>
    ): Array<{ metric: string; threshold: number; actual: number; exceeded: number }>;
    aggregateByPeriod?(periodMs?: number): Array<Record<string, unknown>>;
    config: {
      enabled: boolean;
      sampleRate?: number;
      storageKey?: string;
      metricsRetention?: number;
      enableConsoleOutput?: boolean;
      logLevel?: string;
      [key: string]: unknown;
    };
    RAFScheduler?: { schedule(callback: () => void): () => void; cancelAll(): void };
    LazyLoader?: {
      create(options: Record<string, unknown>): {
        observe(el: Element): void;
        unobserve(el: Element): void;
        disconnect(): void;
      };
      disconnectAll(): void;
    };
    DOMBatcher?: {
      batch(container: Element, elements: Element[]): void;
      flush(): void;
      clear(container: Element): void;
    };
    ElementCache?: {
      get(el: Element, key: string): unknown;
      set(el: Element, key: string, val: unknown): void;
      has(el: Element, key: string): boolean;
      delete(el: Element, key: string): void;
    };
    ObserverRegistry: {
      track(key?: string, observer?: unknown): void;
      untrack(key?: string): void;
      getStats(): { active: number; peak: number; created: number; disconnected: number };
      reset(): void;
      dump(): { observers: { active: number; peak: number; created: number; disconnected: number }; cleanup: unknown };
    };
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // DTOs (i18n.js): the shapes the delivery pipeline actually exchanges.
  // -------------------------------------------------------------------------

  /** A dictionary is flat: every value is a translated string. */
  type TranslationDictionary = Record<string, string>;

  /** Interpolation parameters substituted into a translated string. */
  type TranslationParams = Record<string, string | number>;

  /**
   * LOCALE_DELIVERY_MANIFEST, the single release-pinned record baked into
   * src/i18n.js. `version` is the release the digests belong to, and each
   * locale digest is the SHA-256 of that locale's sorted-key JSON.
   */
  interface LocaleDeliveryManifest {
    version: string;
    candidateDigest: string;
    localeDigests: Record<string, string>;
  }

  /** One verified candidate payload: the dictionary plus its digest. */
  interface LocaleDeliveryCandidate {
    data: TranslationDictionary;
    digest: string;
  }

  /** Structured-clone safe SPA navigation detail. */
  type NavigationDetail = Record<string, unknown>;

  // -------------------------------------------------------------------------
  // YouTubePlusI18n (i18n.js)
  // -------------------------------------------------------------------------

  interface YouTubePlusI18n {
    t(key: string, params?: Record<string, string | number>): string;
    getLanguage(): string;
    setLanguage?(lang: string): void;
    onLanguageChange?(callback: () => void): void;
    hasTranslation?(key: string): boolean;
    translations?: Record<string, unknown>;
    loadTranslations?(lang?: string): Promise<boolean>;
    isReady?(): boolean;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusLogger (logger.js): owner.
  //   Error-boundary methods are kept on this surface as a back-compat
  //   bridge that delegates to YouTubeErrorBoundary.
  // -------------------------------------------------------------------------

  interface YouTubePlusLogger extends YouTubeErrorBoundaryMethods {
    error(module: string, message: string, data?: unknown): void;
    warn(module: string, message: string, data?: unknown): void;
    info(module: string, message: string, data?: unknown): void;
    debug(module: string, message: string, data?: unknown): void;
    setLevel(level: 'error' | 'warn' | 'info' | 'debug'): void;
    getLevel(): 'error' | 'warn' | 'info' | 'debug';
    getRecent(count?: number, filterLevel?: string): Array<Record<string, unknown>>;
    export(): string;
    clear(): void;
    getStats(): Record<string, unknown>;
    createLogger(moduleName: string): {
      error(message: string, data?: unknown): void;
      warn(message: string, data?: unknown): void;
      info(message: string, data?: unknown): void;
      debug(message: string, data?: unknown): void;
    };
  }

  // -------------------------------------------------------------------------
  // YouTubePlusConfig: debug and performance tuning flags.
  // -------------------------------------------------------------------------

  interface YouTubePlusConfig {
    enabled: boolean;
    downloaders: { y2mate: boolean; xbbuddy: boolean };
    debug?: boolean;
    communityWritesEnabled?: boolean;
    performance?: { sampleRate?: number };
    performanceSampleRate?: number;
    perfSampleRate?: number;
    settings?: Record<string, unknown>;
    rebuildDownloadDropdown?: () => void;
  }

  interface YouTubePlusDebug {
    version: string;
    clearAll: () => void;
    stats: () => {
      observers: number;
      listeners: number;
      intervals: number;
      timeouts: number;
      animationFrames: number;
      styles: number;
      notifications: number;
    };
  }

  // -------------------------------------------------------------------------
  // Feature facades (window exports)
  // -------------------------------------------------------------------------

  interface YouTubePlusBasic {
    YouTubeEnhancer: {
      addCustomButtons?: () => void;
      [key: string]: unknown;
    };
    createEnhancer: () => Record<string, unknown>;
    openSettings: () => void;
    closeSettings: () => boolean;
  }

  /** Public settings API namespace exposed by basic.js (window.YouTubePlus). */
  interface YouTubePlusPublicApi {
    openSettings: (opts?: { section?: string }) => boolean;
    closeSettings: () => boolean;
    /** Voting subsystem contributed by voting.js. */
    Voting?: YouTubePlusVoting;
    [key: string]: unknown;
  }

  /** Tab ids rendered by the tabview overlay. */
  type YouTubePlusTabId = '#tab-info' | '#tab-comments' | '#tab-videos' | '#tab-list';

  /**
   * Public tabview surface. Feature modules must use this instead of touching
   * tabview DOM internals: reads come from shared attributes, writes are
   * forwarded to the page-context core, which applies them under its own locks.
   */
  interface YouTubePlusMain {
    communicationKey: () => string;
    isEnabled: () => boolean;
    /** True once the overlay has been mounted for the current page. */
    isReady: () => boolean;
    /** Currently selected tab, or null when tabview is not mounted. */
    getActiveTab: () => YouTubePlusTabId | string | null;
    /** The tab ids this build ships. */
    getTabs: () => YouTubePlusTabId[];
    /** Select a tab. Returns false when the command could not be dispatched. */
    switchToTab: (tab: YouTubePlusTabId | string) => boolean;
    /**
     * Render the comments tab once so YouTube loads it, then restore the
     * prior tab. Runs under the core's keep-comments-scroller lock; callers
     * must never set that attribute themselves.
     */
    preloadComments: () => boolean;
    /** Release the keep-comments-scroller lock taken by preloadComments(). */
    releaseCommentsScroller: () => boolean;
    /** Expand the live chat frame and repair an unloaded chat iframe. */
    expandLiveChat: () => boolean;
    /** Collapse the live chat frame. */
    collapseLiveChat: () => boolean;
    /** Subscribe to tab switches. Returns an unsubscribe function. */
    onTabChange: (cb: (detail: { tab: string | null }) => void) => () => void;
    /** Fires once the page-context command bridge is installed. */
    onReady: (cb: (detail: { tabs: string[] }) => void) => () => void;
  }

  interface YouTubePlusScreenshotFeatureDescriptor {
    id: string;
    titleKey: string;
    fallbackTitle: string;
    /** Settings key; must be a registered store key. Absent when the feature has no settings entry. */
    settingsKey?: string;
    hotkey?: { key: string; allowShift?: boolean; allowModifiers?: boolean };
    iconSVG: string;
    command?: (shim?: unknown) => boolean;
    /** False hides the dock button where the feature cannot run. */
    isAvailable?: () => boolean;
    mountDock?: (
      player: HTMLElement,
      dock: HTMLElement,
      ctx?: { wrap?: HTMLElement }
    ) => void | (() => void);
  }

  type YouTubePlusFeatureDescriptor = YouTubePlusScreenshotFeatureDescriptor;

  /** Resources a lifecycle feature acquires; all released when the feature stops. */
  interface YouTubePlusFeatureContext {
    readonly id: string;
    readonly active: boolean;
    listen: (
      target: EventTarget,
      type: string,
      fn: EventListener,
      opts?: AddEventListenerOptions | boolean
    ) => () => void;
    delegate: (
      root: Document | Element,
      type: string,
      selector: string,
      handler: (ev: Event, target: Element) => void,
      opts?: AddEventListenerOptions
    ) => () => void;
    observe: <T extends MutationObserver | IntersectionObserver | ResizeObserver>(observer: T) => T;
    timeout: (fn: () => void, ms: number) => () => void;
    interval: (fn: () => void, ms: number) => () => void;
    frame: (fn: FrameRequestCallback) => () => void;
    style: (styleId: string, css: string) => () => void;
    own: <E extends Element>(el: E) => E;
    onDispose: (fn: () => void) => () => void;
    scope: () => YouTubePlusFeatureContext;
    dispose: () => void;
  }

  type FeatureContext = YouTubePlusFeatureContext;
  type FeatureScope = YouTubePlusFeatureContext;

  type YouTubePlusRoute =
    | 'home'
    | 'watch'
    | 'shorts'
    | 'search'
    | 'playlist'
    | 'feed'
    | 'channel'
    | 'music'
    | 'studio'
    | 'other';

  interface YouTubePlusLifecycleFeature {
    id: string;
    settingsKey?: string;
    /** Pages the feature runs on. Omitted: every page. */
    routes?: YouTubePlusRoute[];
    /** Extra condition, re-checked on navigation and on `handle.sync()`. Must not throw. */
    when?: () => boolean;
    start: (ctx: YouTubePlusFeatureContext) => void;
    stop?: () => void;
  }

  interface YouTubePlusFeatureHandle {
    sync: () => void;
    isRunning: () => boolean;
    restart: () => void;
  }

  interface YouTubePlusFeatureLifecycle {
    define: (def: YouTubePlusLifecycleFeature) => YouTubePlusFeatureHandle | null;
    isRunning: (id: string) => boolean;
    list: () => string[];
    _reset: () => void;
    createContext: (featureId: string) => YouTubePlusFeatureContext;
  }

  interface YouTubePlusFeatureRegistry {
    SettingsHost: YouTubePlusSettingsHost;
    FeatureLifecycle: YouTubePlusFeatureLifecycle;
    PlayerActionHost: YouTubePlusPlayerActionHost;
    PopoverController: YouTubePlusPopoverController;
    VisionDockHost: YouTubePlusVisionDockHost;
    register: (descriptor: YouTubePlusScreenshotFeatureDescriptor) => boolean;
    get: (id: string) => YouTubePlusScreenshotFeatureDescriptor | null;
    has: (id: string) => boolean;
    list: () => YouTubePlusScreenshotFeatureDescriptor[];
  }

  interface YouTubePlusVisionDockHost {
    getPlayer: (playerEl?: HTMLElement) => HTMLElement | null;
    getDock: () => HTMLElement | null;
    mount: (playerEl?: HTMLElement, ctx?: { wrap?: HTMLElement }) => HTMLElement | null;
    renderFeature: (id: string, player: HTMLElement, dock: HTMLElement, ctx?: { wrap?: HTMLElement }) => void;
    removeFeatureButton: (id: string, dockEl?: HTMLElement) => void;
    ensureVisible: () => void;
    unmount: () => void;
  }

  interface YouTubePlusSettingsHost {
    isEnabled: (settingsKey: string, fallback?: boolean) => boolean;
    onChange: (settingsKey: string, cb: (value: unknown) => void) => () => void;
  }

  interface YouTubePlusPlayerActionHost {
    createButton: (
      desc: YouTubePlusScreenshotFeatureDescriptor,
      opts?: { className?: string; onClick?: (e: Event) => void }
    ) => HTMLButtonElement;
    invokeCommand: (desc: YouTubePlusScreenshotFeatureDescriptor, shim?: unknown) => boolean;
  }

  interface YouTubePlusPopoverController {
    showToast: (message: string, opts?: { duration?: number; type?: string }) => void;
    positionDropdown: (
      anchorEl: Element | null,
      dropdown: HTMLElement | null,
      options?: { preferDown?: boolean; gap?: number }
    ) => boolean;
  }

  interface YouTubePlusScreenshot {
    addButton: (enhancer: unknown, controls?: unknown) => void;
    removeClassicButton?: () => void;
    registerHotkey: (enhancer: unknown) => void;
    DESCRIPTOR?: YouTubePlusScreenshotFeatureDescriptor;
    loadSettings?: () => void;
    saveSettings?: () => void;
    getSettings?: () => {
      storageKey: string;
      shortcut: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };
    };
    attachSettingsHandlers?: (container?: Element | null) => void;
    /** Test-only surface: the internal capture step, not part of the facade root. */
    testHooks?: {
      capture: (enhancer: unknown) => boolean;
      screenshotSettings?: {
        storageKey: string;
        shortcut: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean };
      };
      loadSettings?: () => void;
      saveSettings?: () => void;
      attachSettingsHandlers?: () => void;
      onHotkey?: (e: KeyboardEvent) => void;
    };
  }

  interface YouTubePlusSpeedControl {
    addButton: (enhancer: unknown, controls?: unknown) => void;
    removeClassicButton?: () => void;
    changeSpeed: (enhancer: unknown, speed: number | string) => void;
    applyCurrentSpeed: (enhancer: unknown) => void;
    setupVideoObserver: (enhancer: unknown) => void;
    showSpeedIndicator: (enhancer: unknown, speed: number) => void;
    adjustSpeedByStep: (enhancer: unknown, direction: number) => void;
    refreshVisibility: (enabled: boolean) => void;
    registerHotkeys: (enhancer: unknown) => void;
    /** The Speed Control module owns the speed state;
     * restore reads storage once per boot and returns the owned value. */
    restore: () => number;
    /** Set the owned speed value without persisting. */
    setSpeed: (n: number) => number;
    DESCRIPTOR?: YouTubePlusFeatureDescriptor;
  }

  interface YouTubePlusZoom {
    canRenderZoomUI?: () => boolean;
    // Test-only surface (not public API): internal entry points and state
    // accessors for the zoom runtime.
    testHooks?: {
      readZoomPan: (videoId?: string) => { zoom: number; panX: number; panY: number };
      saveZoomPan: (zoom: number, panX: number, panY: number) => void;
      applyZoomToVideo: (
        video: HTMLVideoElement | null,
        zoom: number,
        panX?: number,
        panY?: number,
        skipTransformTracking?: boolean,
        skipTransition?: boolean
      ) => void;
      findVideoElement: () => HTMLVideoElement | null;
      setFeatureEnabled: (enabled: boolean) => void;
    };
    isMiniplayerActive?: () => boolean;
    cleanup?: () => void;
    rebuildUI?: () => void;
    closestDock?: (el: Element | null) => Element | null;
    DESCRIPTOR?: import('../src/feature-registry').FeatureDescriptor;
    [key: string]: unknown;
  }

  interface YouTubePlusComment {
    // Test-only surface (not public API): internal comment-manager steps.
    testHooks?: {
      isMyActivityCommentsPage: () => boolean;
      isTrustedMyActivityHost: (host: string) => boolean;
      isMyActivityHost: () => boolean;
      settings: { load: () => void; save: () => void };
      CONFIG: { enabled: boolean; storageKey: string; [key: string]: unknown };
      addCheckboxes: () => void;
      addControlButtons: () => void;
      deleteSelectedComments: () => Promise<void>;
      updateDeleteButtonState: () => void;
      addTranslateButton: (commentElement: Element) => void;
      processComments: () => void;
      removeTranslateButtons: () => void;
    };
    [key: string]: unknown;
  }

  interface YouTubePlusUpdate {
    compareVersions: (a: string, b: string) => number;
    parseMetadata: (content: unknown) => {
      version: string | null;
      description: string;
      downloadUrl: string;
      changelog?: string;
    };
    formatTimeAgo: (timestamp: number | null | undefined) => string;
    saveSettings: () => void;
    loadSettings: () => void;
    checkForUpdates: (force?: boolean, retryCount?: number) => Promise<void>;
    UPDATE_CONFIG: Record<string, unknown>;
    updateState: Record<string, unknown>;
    init: () => void;
    [key: string]: unknown;
  }

  interface YouTubePlusEndscreen {
    // Test-only surface (not public API): internal entry points and state
    // accessors for the end-screen remover.
    testHooks?: {
      fastRemove: (elements: HTMLElement[]) => void;
      removeEndScreens: (opts?: { force?: boolean }) => void;
      isRelevantNode: (node: Node) => boolean;
      state: { removeCount: number; lastCheck: number };
      CONFIG: { selectors: string; debounceMs: number; batchSize: number };
    };
  }

  interface YouTubePlusPerformanceMode {
    // Test-only surface (not public API): the route-scoped page-cost
    // reductions and their entry points.
    testHooks?: {
      MASTER_KEY: string;
      PARTS: ReadonlyArray<{
        id: string;
        setting: string;
        styleId: string | null;
        routeKey: string;
        routes: YouTubePlusRoute[];
      }>;
      CSS: Readonly<Record<string, string>>;
      masterOn: () => boolean;
      partOn: (key: string) => boolean;
      syncAll: () => void;
    };
  }

  interface YouTubePlusAnimations {
    // Test-only surface (not public API).
    testHooks?: {
      SETTING_KEY: string;
      STYLE_ID: string;
      ROUTES: YouTubePlusRoute[];
      CSS: string;
      performanceModeOn: () => boolean;
    };
  }

  interface YouTubePlusTimecode {
    parseTime: (timeStr: string) => number | null;
    parseLeadingTimestampToken: (input: string) => { token: string; length: number } | null;
    stripLeadingTimePrefix: (value: string) => string;
    formatTime: (seconds: number) => string;
    createTimecodePanel: () => HTMLElement;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
    init: () => void;
    cleanup: () => void;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusStats (stats.js): channel statistics overlay
  // -------------------------------------------------------------------------

  interface YouTubePlusStats {
    init: () => void;
    cleanup: () => void;
    DESCRIPTOR?: import('../src/feature-registry').FeatureDescriptor;
    openStatsModal?: (type: string, videoId: string) => void;
    initVideoStats?: () => void;
    ensureShortsStatsButton?: () => void;
    getPageVideoStats?: () => Record<string, unknown> | null;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // Voting DTOs (voting.js): the row shapes the community RPCs return.
  // Every reader narrows these with asIdText_/asCount_ before use, so a
  // malformed field stays "unknown" instead of becoming a fabricated zero.
  // -------------------------------------------------------------------------

  /** One page of `get_feature_requests`. */
  interface VotingFeatureRow {
    id: string;
    title: string;
    description?: string | null;
    status?: string;
    created_at?: string | null;
    upvotes?: number;
    downvotes?: number;
    comment_count?: number;
    [key: string]: unknown;
  }

  /** The raw `get_feature_requests` page body, before the client narrows it. */
  interface VotingFeatureListPage {
    rows: unknown[];
    hasMore: boolean;
    nextCursorCreatedAt?: string | null;
    nextCursorId?: string | null;
  }

  /** `get_preview_feature` resolves to at most one row. */
  interface VotingPreviewFeature {
    feature: VotingFeatureRow | null;
    error: string | null;
  }

  /** One row of `get_vote_counts`. */
  interface VotingVoteCountRow {
    feature_id: string;
    upvotes: number;
    downvotes: number;
  }

  /** One row of `get_feature_comment_counts`. */
  interface VotingCommentCountRow {
    feature_id: string;
    comment_count: number;
  }

  /** One row of `get_feature_comments`. */
  interface VotingCommentRow {
    id: string;
    feature_id: string;
    comment: string;
    created_at?: string | null;
    [key: string]: unknown;
  }

  /** One row of `get_feature_images` / `get_comment_images`. */
  interface VotingImageRow {
    /** Feature images key on `feature_id`, comment images on `comment_id`. */
    feature_id?: string;
    comment_id?: string;
    storage_path: string;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  /** A stored image after the proxy URL has been resolved onto it. */
  type VotingResolvedImage = VotingImageRow & { url: string };

  /** One row of `get_my_votes`. */
  interface VotingMyVoteRow {
    feature_id: string;
    vote_type: number;
  }

  /** A write result: the server either applied the change or reported why not. */
  interface VotingWriteResult {
    success: boolean;
    error?: string;
    action?: string;
    data?: unknown;
  }

  /**
   * One client-side image draft: the decoded, re-encoded blob plus the preview
   * URL and the fields the upload slots are built from. Scoped to memory only.
   */
  interface VotingImageDraft {
    draftId: string;
    file: File;
    blob: Blob;
    mimeType: string;
    previewUrl: string;
    width: number;
    height: number;
    size: number;
    status: 'pending' | 'uploaded' | 'error';
    error: string | null;
  }

  /** An in-flight batch of drafts sharing one owner capability. */
  interface VotingUploadSession {
    featureId: string;
    commentId: string;
    ownerCapability: string;
    pendingDrafts: VotingImageDraft[];
  }

  /** Every aggregate reader reports the rows it collected plus the first error. */
  interface VotingAggregate<T> {
    error: string | null;
  }

  interface VotingVoteCounts extends VotingAggregate<Record<string, VotingVoteCountRow>> {
    votes: Record<string, { upvotes: number; downvotes: number }>;
  }

  interface VotingCommentCounts extends VotingAggregate<Record<string, VotingCommentCountRow>> {
    counts: Record<string, number>;
  }

  interface VotingFeatureImages extends VotingAggregate<Record<string, VotingImageRow>> {
    images: Record<string, VotingResolvedImage[]>;
  }

  interface VotingCommentImages extends VotingAggregate<Record<string, VotingImageRow>> {
    images: Record<string, VotingResolvedImage[]>;
  }

  interface VotingComments extends VotingAggregate<Record<string, VotingCommentRow>> {
    comments: Record<string, VotingCommentRow[]>;
  }

  interface VotingMyVotes extends VotingAggregate<VotingMyVoteRow> {
    userVotes: Record<string, number>;
  }

  /** The vote slider's aggregate for ONE feature: its two counters. */
  interface VotingVoteTotals {
    upvotes: number;
    downvotes: number;
  }

  /** The whole-page aggregate: authoritative flag plus every feature's counters. */
  interface VotingVoteTable {
    ok: boolean;
    votes: Record<string, VotingVoteTotals>;
  }

  // -------------------------------------------------------------------------
  // RYD DTO (stats.js): the shared return-value service.
  // -------------------------------------------------------------------------

  /** One `get_vote` style RYD payload: counts plus the caller's own vote. */
  interface RydVoteResponse {
    videoId: string;
    likes?: number;
    dislikes?: number;
    rating?: number;
    viewCount?: number;
    deleted?: boolean;
    error?: string | null;
    [key: string]: unknown;
  }

  interface YouTubePlusVoting {
    init: () => void;
    createUI: (container: HTMLElement) => void;
    loadFeatures: () => Promise<void>;
    getFeatures: () => Promise<unknown[]>;
    vote: (featureId: string, voteType: number) => Promise<{ success: boolean; action?: string; error?: string }>;
    submitFeature: (title: string, description: string) => Promise<{ success: boolean; error?: string }>;
    initSlider: () => void;
    updateVoteBar: (
      allVotes: Record<string, VotingVoteTotals>,
      userVotes: Record<string, number>,
      previewFeatureId: string | null,
      countsState?: 'ok' | 'partial' | 'unavailable'
    ) => void;
    normalizeVoteType: (value: unknown) => 1 | -1 | 0;
    [key: string]: unknown;
  }

  interface YouTubePlusAdBlocker {
    skipAd: () => void;
    dismissAdBlockerWarning: () => void;
    settings: { load: () => void; save: () => void };
    [key: string]: unknown;
  }

  interface YouTubePlusPip {
    cleanup?: () => void;
    // Test-only surface (not public API): internal entry points and state
    // accessors for the PiP runtime.
    testHooks?: {
      init: () => void;
      keyToCode: (key: string) => string;
      isFeatureEnabled: () => boolean;
      getSettings: () => Record<string, unknown>;
    };
    [key: string]: unknown;
  }

  interface YouTubePlusThumbnail {
    // Test-only surface (not public API): internal entry points and state
    // accessors for the thumbnail-preview runtime.
    testHooks?: {
      extractVideoId: (src: string) => string | null;
      extractShortsId: (href: string) => string | null;
      getVideoThumbnailUrls: (videoId: string) => { primary: string; fallback: string };
    };
    getShortsThumbnailUrls: (videoId: string) => { primary: string; fallback: string };
    showImageModal: (url: string) => void;
    /** Register a deduped click handler for a dock button; returns its disposer. */
    registerDockButtonListener: (
      button: HTMLElement,
      handler: (e: Event) => void
    ) => () => void;
    DESCRIPTOR?: YouTubePlusFeatureDescriptor;
    [key: string]: unknown;
  }

  interface YouTubePlusShorts {
    // Test-only surface (not public API): state accessors for the Shorts
    // keyboard controls.
    testHooks?: {
      isOnShortsPage: () => boolean;
      getDefaultShortcuts: () => Record<string, { key: string; description: string; editable?: boolean }>;
      getSettings: () => { shortcuts: Record<string, { key: string; description: string; editable?: boolean }> };
    };
  }

  interface YouTubePlusPlayall {
    // Test-only surface (not public API): internal entry points and state
    // accessors for the play-all runtime.
    testHooks?: {
      init: () => void;
      cleanup?: () => void;
      isSupportedTabPath: () => boolean;
      isFeatureEnabled: () => boolean;
      setFeatureEnabled: (enabled: boolean) => void;
    };
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusEnhanced (enhanced.js): dislike fallback, tabview helpers
  // -------------------------------------------------------------------------

  interface YouTubePlusEnhanced {
    getVideoIdForDislike?: () => string | null;
    formatCompactNumber?: (n: number) => string;
    isTabviewEnabled?: () => boolean;
    resolveMusicContainers?: () => Element[];
    invalidateMusicContainersCache?: () => void;
    getUniversalScrollContainer?: () => Element | null;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusPlaylistSearch (playlist-search.js): playlist page detection
  // -------------------------------------------------------------------------

  interface YouTubePlusPlaylistSearch {
    isPlaylistPage: () => boolean;
    shouldRunOnThisPage: () => boolean;
    isRelevantRoute: () => boolean;
    getCurrentPlaylistId: () => string | null;
    getPlaylistDisplayName: (playlistPanel: Element | HTMLElement, listId: string) => string;
    getPlaylistContext: () => Record<string, unknown> | null;
    deleteSelectedItems?: () => Promise<void>;
    removeItemViaMenu?: (
      item: Element,
      opts?: { token?: { item: Element; videoId: string; itemsRoot: Element } }
    ) => Promise<{
      status: 'unconfirmed' | 'failed' | 'cancelled' | 'unknown' | 'not_removed';
      clicked: boolean;
      detail?: string;
    }>;
    cancelBatchDeletion?: () => void;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusReport (report.js): stats/report rendering
  // -------------------------------------------------------------------------

  interface YouTubePlusReport {
    render: (reportSection: Element) => void;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusTimeLoop (time.js): resume overlay, loop control
  // -------------------------------------------------------------------------

  interface YouTubePlusTimeLoop {
    toggleLoop: () => void;
    setLoopPoint: (point: 'A' | 'B') => void;
    resetLoopPoints: () => void;
    applyLoopStateToCurrentVideo: () => void;
    registerHotkeys: (enhancer?: { settings?: { enableLoop?: boolean }; isEditableTarget?: (target: EventTarget | null | undefined) => boolean } | null) => void;
    getLoopState?: () => {
      enabled: boolean;
      pointA: number | null;
      pointB: number | null;
      frameA?: string | null;
      frameB?: string | null;
    };
    captureCurrentFrame?: () => string | null;
    updateLoopProgressBar?: () => void;
    addClassicLoopButton?: (controls: HTMLElement) => void;
    removeClassicLoopButton?: () => void;
    refreshVisibility?: (enabled: boolean) => void;
    DESCRIPTOR?: YouTubePlusFeatureDescriptor;
    [key: string]: unknown;
  }

  interface ResumeEntry {
    time: number;
    updatedAt: number;
    [key: string]: unknown;
  }

  interface YouTubePlusTimeResume {
    createOverlay: (
      seconds: number,
      onResume: () => void,
      onRestart: () => void,
      videoId?: string,
      scope?: YouTubePlusFeatureContext
    ) => void;
    readResumeEntries: () => Map<string, ResumeEntry>;
    stageResumeEntry: (videoId: string, seconds: number) => void;
    initResume?: () => void;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusEventDelegation (event-delegation.js)
  // -------------------------------------------------------------------------

  interface YouTubePlusEventDelegation {
    delegate: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function,
      options?: object
    ) => () => void;
    undelegate: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function,
      options?: object
    ) => void;
    on: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function,
      options?: object
    ) => () => void;
    off: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function,
      options?: object
    ) => void;
    getStats: () => Record<string, unknown>;
    attachHoverPopover: (
      anchor: HTMLElement,
      panel: HTMLElement,
      opts: {
        show: () => void;
        hide: () => void;
        hideDelay?: number;
        extraAnchors?: HTMLElement[];
      }
    ) => () => void;
  }

  // -------------------------------------------------------------------------
  // YouTubeSafeDOM (safe-dom.js): safe HTML and sanitization.
  // -------------------------------------------------------------------------

  interface YouTubeSafeDOM {
    setInnerHTML?: (element: Element, html: string) => void;
    createHTML(html: string): string;
    createSafeHTML(html: string): string;
    createFragment(html: string): DocumentFragment;
    sanitizeHTML(html: string): string;
    setHTML(element: Element, html: string, options?: { sanitize?: boolean }): void;
    renderTemplateClone(element: Element, html?: string): void;
    setText(element: Element, text: string): void;
    escapeHTML(text: string): string;
    createTrustedHTML(html: string): string;
    createTrustedScript(text: string): string | null;
    getTrustedTypesPolicy(): unknown;
    sanitizeAttribute(name: string, value: string): string | null;
    setAttributeSafe(element: Element, name: string, value: string): void;
    isSafeUrl(url: string): boolean;
    /** @deprecated Use a module-local helper. */
    isValidVideoId(id: string): boolean;
    /** @deprecated Sanitize via the HTML allowlist path instead. */
    sanitizeText(text: string): string;
  }

  // -------------------------------------------------------------------------
  // YouTubeDOMCache (dom-cache.js): DOM query, wait and cache.
  // -------------------------------------------------------------------------

  interface YouTubeDOMCache {
    querySelector(selector: string, ctx?: Element | Document, skipCache?: boolean): Element | null;
    querySelectorAll(
      selector: string,
      ctx?: Element | Document,
      skipCache?: boolean
    ): Element[];
    getElementById(id: string): Element | null;
    invalidate(selector?: string): void;
    clear(): void;
    getStats(): { size: number; enabled: boolean };
    destroy(): void;

    // Aliases
    query(selector: string, ctx?: Element | Document): Element | null;
    queryAll(selector: string, ctx?: Element | Document): Element[];
    byId(id: string): Element | null;
    get(selector: string): Element | null;
    getAll(selector: string): Element[];
    waitForElement(selector: string, timeout?: number, parent?: Element | Document): Promise<Element | null>;

    // Internal fields used by the DOMCache class (not part of the
    // public API, but referenced by the wait/retry helpers).
    initSharedObserver?: () => void;
    observerCallbacks?: Set<() => boolean>;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusMutationCoordinator (mutation-coordinator.js)
  // -------------------------------------------------------------------------

  interface SubscriptionOptions {
    selector?: string | null;
    attributes?: boolean;
    childList?: boolean;
    subtree?: boolean;
    attributeFilter?: string[] | null;
  }

  interface YouTubePlusMutationCoordinatorAPI {
    subscribeRoot(
      id: string,
      callback: (mutations: MutationRecord[]) => void,
      options?: SubscriptionOptions
    ): string | null;
    subscribe(
      id: string,
      callback: (mutations: MutationRecord[]) => void,
      options?: SubscriptionOptions
    ): string | null;
    unsubscribe(id: string | null): void;
    watchTarget(
      id: string,
      target: Node,
      callback: (mutations: MutationRecord[]) => void,
      options?: SubscriptionOptions
    ): string | null;
    watch(
      id: string,
      target: Node,
      callback: (mutations: MutationRecord[]) => void,
      options?: SubscriptionOptions
    ): string | null;
    unwatch(id: string): void;
    createRetryScheduler(opts: {
      check: () => boolean;
      maxAttempts?: number;
      interval?: number;
      onGiveUp?: () => void;
      label?: string;
    }): { stop: () => void };
    getStats(): {
      rootSubscribers: number;
      rootObserverActive: boolean;
      managedTimers: number;
      paused: boolean;
    };
    pause(): void;
    resume(): void;
    dispose(): void;
    whenRelevant(config: {
      name?: string;
      isRelevant: () => boolean;
      onEnter?: () => void;
      onLeave?: () => void;
      signals?: string[];
    }): { active: boolean; check: () => void; dispose: () => void };
    onSectionActive(
      sectionId: string,
      onEnter: () => void,
      onLeave?: () => void
    ): { dispose: () => void };
  }

  // -------------------------------------------------------------------------
  // YouTubePlusSettingsHelpers (settings-helpers.js template HTML).
  // -------------------------------------------------------------------------

  interface YouTubePlusSettingsHelpers {
    createSettingsSidebar: (t: Function) => string;
    createMainContent: (settings: Record<string, unknown>, t: Function) => string;
    createSettingsItem: (
      label: string,
      description: string,
      setting: string,
      checked: boolean
    ) => string;
    createSettingsSelect: (
      label: string,
      description: string,
      setting: string,
      value: string | number,
      options: Array<{ value: string | number; label: string }>
    ) => string;
    createDownloadSiteOption: (
      site: {
        key: string;
        name: string;
        description: string;
        checked: boolean;
        hasControls: boolean;
        controls?: string;
      },
      t: Function
    ) => string;
    createAdvancedSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    createExperimentalSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    createBasicSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    readSubmenuExpanded: (key: string) => boolean | null;
    buildScreenshotSettingsHTML: (settings: Record<string, unknown>, t: Function) => string;
    createVotingSection: (settings: Record<string, unknown>, t: Function) => string;
    getMusicSettings: () => Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusSettingsStore (store in settings-helpers.js).
  // -------------------------------------------------------------------------

  interface YouTubePlusSettingsStore {
    STORAGE_KEYS: Readonly<{ main: string; all: string; music: string }>;
    DEFAULTS: Readonly<Record<string, unknown>>;
    MUSIC_DEFAULTS: Readonly<Record<string, unknown>>;
    FEATURE_DEFAULTS: Readonly<Record<string, unknown>>;
    KEY_REGISTRY: ReadonlySet<string>;
    load: () => Record<string, unknown>;
    save: (settings: Record<string, unknown> | null | undefined) => void;
    importSettings?: (data: string | Record<string, unknown> | null | undefined) => boolean;
    get: <T = unknown>(path: string, defaultValue?: T) => T;
    set: (path: string, value: unknown) => boolean;
    update: (path: string, patch: unknown) => boolean;
    hasKey: (key: string) => boolean;
    getFeature: (featureId: string) => Record<string, unknown>;
    updateFeature: (featureId: string, patch: Record<string, unknown> | null | undefined) => boolean;
    getModuleSettings: (name: string) => Record<string, unknown>;
    updateModuleSettings: (name: string, patch: Record<string, unknown>) => boolean;
    hasSharedSettings: () => boolean;
    moduleBridge: () => YouTubePlusSettingsStore | null;
    affectsModule: (event: unknown, name: string, alsoKeys?: string[]) => boolean;
    readGmKey: (key: string) => string | null;
    writeGmKey: (key: string, value: string) => boolean;
    subscribe: (pathOrFeature: string, callback: (value: unknown) => void) => () => void;
    getMusicSettings: () => Record<string, unknown>;
    updateMusicSettings: (patch: Record<string, unknown>) => boolean;
    subscribeMusicSettings: (callback: (value: unknown) => void) => () => void;
    readRaw: (key: string) => string | null;
    writeRaw: (key: string, value: string) => boolean;
    removeRaw: (key: string) => boolean;
    clearRaw: (prefixes: string[]) => number;
    reset: () => void;
    _internals: Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusSettingsModal (settings-modal.js): modal builder/open API.
  // -------------------------------------------------------------------------

  interface YouTubePlusSettingsModal {
    create: (enhancer: unknown) => HTMLElement;
    open: (enhancer: unknown) => void;
    /** Idempotent dispose of the active modal session. */
    close: () => boolean;
    /** Modal-owned UI session state: submenu states, section hints. */
    basicUiState: {
      submenuStates: {
        read: () => Record<string, unknown>;
        write: (next: Record<string, unknown>) => void;
      };
      activeNavSection: { read: () => string; write: (id: string) => void };
      lastOpenSection: { read: () => string; write: (id: string) => void };
    };
  }

  // -------------------------------------------------------------------------
  // YouTubePlusModalHandlers (modal-handlers.js): settings-modal UI.
  // -------------------------------------------------------------------------

  interface YouTubePlusModalHandlers {
    setSettingByPath: (settings: object, path: string, value: unknown) => void;
    initializeDownloadSites: (settings: object) => void;
    toggleDownloadSiteControls: (checkbox: HTMLInputElement) => void;
    safelySaveSettings: (settings: object) => void;
    createFocusTrap: (container: HTMLElement) => () => void;
    applySettingLive: (setting: string, context: SettingsModalContext) => void;
    /** Swap the active nav item and make its section visible; returns the section id. */
    activateSettingsSection: (navItem: HTMLElement, modal: HTMLElement) => string | undefined;
    handleSidebarNavigation: (navItem: HTMLElement, modal: HTMLElement) => void;
    handleDownloadSiteToggle: (
      target: HTMLElement,
      key: string,
      settings: object,
      saveSettings: Function
    ) => void;
    isMusicSetting: (path: string) => boolean;
    handleMusicSettingToggle: (target: HTMLElement, setting: string) => void;
    handleSimpleSettingToggle: (
      target: HTMLElement,
      setting: string,
      settings: object,
      context: SettingsModalContext,
      saveSettings: Function,
      modal: HTMLElement
    ) => void;
    handleDownloadSiteInput: (
      target: HTMLElement,
      site: string,
      field: string,
      settings: object,
      t: Function
    ) => void;
    // Settings-modal UI widget helpers. design-system.js keeps a lazy
    // back-compat shim that delegates here.
    resolveModifierComboValue: (shortcut: {
      ctrlKey?: boolean;
      altKey?: boolean;
      shiftKey?: boolean;
    } | null | undefined) => string;
    formatModifierComboLabel: (
      value: string,
      options?: { noneLabel?: string; translatePart?: ((part: string) => string) | null }
    ) => string;
    buildModifierComboOptionItems: (
      selectedValue: string,
      formatLabel?: (value: string) => string
    ) => string;
    buildModifierComboDropdownItems: (
      selectedValue: string,
      formatLabel?: (value: string) => string
    ) => string;
    initGlassDropdown: (config: {
      dropdown: Element | HTMLElement | string | null;
      hiddenSelect: Element | HTMLSelectElement | string | null;
      onChange?: (val: string) => void;
      onOpen?: () => void;
    }) => () => void;
    handleModalClickActions: (
      target: HTMLElement,
      modal: HTMLElement,
      handlers: YouTubePlusModalHandlers,
      context: SettingsModalContext,
      translate: Function
    ) => void;
    handleThemeOptionsClick: (
      target: HTMLElement,
      modal: HTMLElement,
      handlers: YouTubePlusModalHandlers,
      context: SettingsModalContext
    ) => boolean;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusModalDownloadHandlers (modal-download-handlers.js): download
  // site and external downloader settings handlers. Extracted from
  // modal-handlers.js in Stage 5; its members are also re-attached onto
  // window.YouTubePlusModalHandlers via Object.assign at load time.
  // -------------------------------------------------------------------------

  interface YouTubePlusModalDownloadHandlers {
    initializeDownloadSites: (settings: object) => void;
    toggleDownloadSiteControls: (checkbox: HTMLInputElement) => void;
    handleDownloadSiteToggle: (
      target: HTMLElement,
      key: string,
      settings: object,
      saveSettings: Function
    ) => void;
    initializeDownloadCustomization: (settings: object) => void;
    initializeDownloadSite: (settings: object, site: string) => void;
    getDownloadSiteFallbackName: (key: string, t: Function) => string;
    updateDownloadSiteName: (target: HTMLElement, site: string, t: Function) => void;
    rebuildDownloadDropdown: (settings: object) => void;
    handleDownloadSiteInput: (
      target: HTMLElement,
      site: string,
      field: string,
      settings: object,
      t: Function
    ) => void;
    ensureExternalDownloaderStructure: (settings: object) => void;
    readExternalDownloaderInputs: (container: HTMLElement, settings: object) => void;
    handleExternalDownloaderSave: (
      target: HTMLElement,
      settings: object,
      saveSettings: Function,
      showNotification: Function,
      t: Function
    ) => void;
    resetExternalDownloaderToDefaults: (settings: object) => void;
    updateExternalDownloaderModalInputs: (container: HTMLElement, settings: object) => void;
    handleExternalDownloaderReset: (
      modal: HTMLElement,
      settings: object,
      saveSettings: Function,
      showNotification: Function,
      t: Function
    ) => void;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusDesignSystem (design-system.js): theme sync, StyleManager,
  // the design-system token CSS bundle and the static CSS registry. The
  // settings-modal UI widget helpers live in YouTubePlusModalHandlers and
  // stay reachable here through a lazy back-compat bridge.
  // -------------------------------------------------------------------------

  interface YouTubePlusDesignSystem {
    StyleManager: {
      styles: Map<string, string>;
      has: (id: string) => boolean;
      get: (id: string) => string;
      add: (id: string, css: string) => void;
      remove: (id: string) => void;
      clear: () => void;
    };
    getStyle: (id: string) => string;
    resolveTheme: () => 'dark' | 'light';
    syncTheme: () => void;
    applyThemeVariant: (explicitVariant?: string, explicitStyle?: string) => void;
    getThemeVariant: () => 'classic' | 'vision';
    repairStyles?: () => void;
    inspectStyles?: () => {
      hostPresent: boolean;
      hostConnected: boolean;
      hostTextLength: number;
      expectedTextLength: number;
      registeredStyleIds: string[];
      textMatchesExpected: boolean;
    };
    // Back-compat bridge (lazy delegation to YouTubePlusModalHandlers):
    resolveModifierComboValue: YouTubePlusModalHandlers['resolveModifierComboValue'];
    formatModifierComboLabel: YouTubePlusModalHandlers['formatModifierComboLabel'];
    buildModifierComboOptionItems: YouTubePlusModalHandlers['buildModifierComboOptionItems'];
    buildModifierComboDropdownItems: YouTubePlusModalHandlers['buildModifierComboDropdownItems'];
    initGlassDropdown: YouTubePlusModalHandlers['initGlassDropdown'];
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusDownload (download.js)
  // -------------------------------------------------------------------------

  interface DownloadOptions {
    format?: string;
    quality?: string;
    audioBitrate?: string;
    embedThumbnail?: boolean;
    source?: string;
    onProgress?: ((progress: unknown) => void) | null;
    onCancel?: (() => boolean) | null;
    onRequest?: ((request: unknown) => void) | null;
    onComplete?: (() => void) | null;
    [key: string]: unknown;
  }

  interface SubtitleDownloadOptions {
    videoId: string;
    url: string;
    languageCode: string;
    languageName: string;
    isAutoGenerated: boolean;
    format: string;
    translateTo?: string | null;
    trackId?: string;
  }

  interface YouTubePlusDownload {
    downloadVideo(options?: DownloadOptions): Promise<void>;
    downloadViaCobalt(options?: DownloadOptions): Promise<void>;
    downloadViaDirectStream(options?: DownloadOptions): Promise<void>;
    enqueueDownload(options: DownloadOptions): Promise<void>;
    getSubtitles(videoId: string): Promise<SubtitleData | null>;
    downloadSubtitle(options: SubtitleDownloadOptions): Promise<void>;
    openModal(): void;
    init(): void;
    isHttpUrl(url: string): boolean;
    isHttpsUrl(url: string): boolean;
    DownloadConfig: Record<string, unknown>;
    DESCRIPTOR?: YouTubePlusFeatureDescriptor;
    /** POT hook lifecycle (session-once): exported for lifecycle tests. */
    _installPotHooksOnce(): void;
    /** Transport primitives: exported for cancel/lifecycle tests. */
    gmXmlHttpRequest(options: Record<string, unknown>): Promise<unknown>;
    downloadBlobFromUrl(options?: {
      url?: string;
      converter?: { referer?: string };
      onProgress?: ((p: unknown) => void) | null;
      onRequest?: ((req: unknown) => void) | null;
      timeout?: number;
      [key: string]: unknown;
    }): Promise<Blob>;
  }

  // -------------------------------------------------------------------------
  // Subtitles / captions
  // -------------------------------------------------------------------------

  interface SubtitleCue {
    start: number;
    duration: number;
    text: string;
  }

  interface SubtitleTrack {
    name: string;
    languageCode: string;
    sourceLanguageCode?: string;
    baseUrl: string;
    url: string;
    isAutoGenerated: boolean;
    trackId: string;
    kind?: string;
    translateTo?: string;
  }

  interface SubtitleData {
    videoId: string;
    videoTitle: string;
    subtitles: SubtitleTrack[];
    autoTransSubtitles: SubtitleTrack[];
  }

  interface CaptionTrack {
    name?: { simpleText?: string };
    languageCode: string;
    baseUrl: string;
    kind?: string;
    vssId?: string;
    isTranslatable?: boolean;
  }

  interface CaptionTranslationLanguage {
    languageName?: { simpleText?: string };
    languageCode: string;
  }

  interface PlayerCaptionsTracklistRenderer {
    captionTracks?: CaptionTrack[];
    translationLanguages?: CaptionTranslationLanguage[];
  }

  interface PlayerResponseData {
    captions?: {
      playerCaptionsTracklistRenderer?: PlayerCaptionsTracklistRenderer;
    };
    videoDetails?: {
      title?: string;
      videoId?: string;
      author?: string;
      viewCount?: string;
      lengthSeconds?: string;
      channelId?: string;
      thumbnail?: {
        thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
      };
    };
    microformat?: {
      playerMicroformatRenderer?: {
        ownerProfileUrl?: string;
        ownerUrls?: string[];
        isFamilySafe?: boolean;
      };
    };
    streamingData?: {
      formats?: Array<{ mimeType?: string; qualityLabel?: string; [key: string]: unknown }>;
      adaptiveFormats?: Array<{ mimeType?: string; qualityLabel?: string; [key: string]: unknown }>;
    };
  }

  interface PlayerResponse extends PlayerResponseData {}

  // -------------------------------------------------------------------------
  // GM / Tampermonkey types
  // -------------------------------------------------------------------------

  interface GMResponseLike {
    status: number;
    statusText?: string;
    finalUrl?: string;
    headers?: Record<string, string>;
    responseText?: string | null;
    response?: string | Blob | ArrayBuffer | ArrayBufferView | Document | null;
    responseXML?: Document | null;
  }

  interface GMRequestOptions {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    responseType?: 'text' | 'blob' | 'arraybuffer' | 'document' | string;
    withCredentials?: boolean;
    anonymous?: boolean;
    onload?: (response: GMResponseLike) => void;
    onerror?: (error: unknown) => void;
    ontimeout?: () => void;
    [key: string]: unknown;
  }

  interface GMRequestProfile {
    method?: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    responseType?: 'text' | 'blob' | 'arraybuffer' | 'document' | string;
    withCredentials?: boolean;
    anonymous?: boolean;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // Channel / stats types
  // -------------------------------------------------------------------------

  interface ChannelTabRenderer {
    tabRenderer?: {
      endpoint?: {
        commandMetadata?: {
          webCommandMetadata?: {
            url?: string;
          };
        };
      };
    };
  }

  interface ChannelBrowseData {
    contents?: {
      twoColumnBrowseResultsRenderer?: {
        tabs?: ChannelTabRenderer[];
      };
    };
  }

  interface ChannelFeatureFlags {
    hasStreams: boolean;
    hasShorts: boolean;
  }

  interface StatsRateLimiter {
    requests: Map<string, number[]>;
    maxRequests: number;
    maxKeys: number;
    timeWindow: number;
    canRequest(key: string): boolean;
    clear(): void;
  }

  interface VideoStatsFields {
    views: number | null;
    likes: number | null;
    dislikes: number | null;
    comments: number | null;
    liveViewer: number | null;
    title: string;
    thumbUrl: string;
    country: string | null;
    monetized: boolean | null;
    duration?: string | null;
    author?: string | null;
    authorHandle?: string | null;
  }

  // -------------------------------------------------------------------------
  // Browser extension targets (used by main.js for prototype-patched
  // element shims; see `000`/`111` naming convention).
  // -------------------------------------------------------------------------

  interface HTMLInputElementEventTarget extends EventTarget {
    checked: boolean;
    value: string;
  }

  interface HTMLElementEventTarget extends EventTarget {
    classList: DOMTokenList;
    closest: (selector: string) => Element | null;
    matches: (selector: string) => boolean;
    dataset: DOMStringMap;
    id: string;
    style: CSSStyleDeclaration;
    value?: string;
    checked?: boolean;
  }

  interface Scheduler {
    yield(): Promise<void>;
  }

  /** YouTube's page timing hook, wrapped so the first read applies the config. */
  interface YtTimingFunction {
    (...args: unknown[]): unknown;
    originalYtcsi?: YtTimingFunction;
  }

  // -------------------------------------------------------------------------
  // Element / Node / Document augmentations
  // -------------------------------------------------------------------------

  interface Element {
    setAttribute000(name: string, value: string): void;
    getAttribute000(name: string): string | null;
    hasAttribute000(name: string): boolean;
    removeAttribute000(name: string): void;
    querySelector000(selector: string): Element | null;
    replaceChildren000(...nodes: Node[]): void;
    setAttribute111(name: string, value: unknown): void;
    incAttribute111(name: string): number;
    assignChildren111(
      prev: Node[] | null | undefined,
      node: Node,
      next: Node[] | null | undefined
    ): void;
    _topButtonScrollHandler?: EventListener | null;
    _scrollObserver?: IntersectionObserver | null;
    _scrollCleanup?: (() => void) | null;
    _ytpScrollAttached?: boolean;
    /** Read through a generic `Element` result in the download modal. */
    value?: string;
  }

  interface Node {
    textContent?: string | null;
    appendChild000<T extends Node>(child: T): T;
    insertBefore000<T extends Node>(newNode: T, refNode: Node | null): T;
  }

  /** A select-like control the download and subtitle menus build from an element. */
  interface YtpCustomSelect extends HTMLElement {
    _options: Array<{ text: string; value: string | number }>;
    _value?: string;
    _disabled?: boolean;
    value?: string;
    disabled?: boolean;
    setPlaceholder?(text: string): void;
    setOptions?(options: Array<{ text: string; value: string | number }>): void;
    destroy?(): void;
    [key: string]: unknown;
  }

  interface HTMLVideoElement {
    /** Set while the resume-time feature has a listener on this element. */
    _ytpResumeAttached?: boolean;
    /** Pending pan repaint cancel function held by the zoom feature. */
    _panRAF?: (() => void) | null;
  }

  interface ParentNode {
    replaceChildren000(...nodes: Node[]): void;
  }

  interface DocumentFragment extends ParentNode {}

  interface CustomElementRegistry {
    define000(name: string, constructor: CustomElementConstructor, options?: ElementDefinitionOptions): void;
  }

  interface Document {
    webkitFullscreenElement?: Element | null;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
  }

  // -------------------------------------------------------------------------
  // Timer ID type alias
  // -------------------------------------------------------------------------

  type TimerId = number | ReturnType<typeof setTimeout>;
  type IntervalId = number | ReturnType<typeof setInterval>;

  // -------------------------------------------------------------------------
  // Window augmentation
  // -------------------------------------------------------------------------

  interface YouTubePlusHostPolicy {
    hostClass: () => 'youtube' | 'myactivity' | 'other';
    /** True on the origin that owns and seeds the shared settings blob. */
    ownsSharedSettings: () => boolean;
    /** Module name -> hosts it may run on, generated from build.order.json. */
    table: Record<string, string[]>;
    runs: (name: string) => boolean;
  }

  interface Window {
    // Browser facades
    __ytpMainExecDone__?: boolean;
    /** Set when the basic runtime finishes its boot step. */
    __ytpBasicInitDone__?: boolean;
    /** Set once the Firefox page-side PiP bridge handled a request. */
    __ytplusPipPageHandled?: boolean;
    /** YouTube's page timing hook (`ytcsi`), wrapped to apply config once. */
    ytcsi?: YtTimingFunction;
    /** Set once the SPA navigation cleanup listeners are installed. */
    __ytp_nav_cleanup_registered?: boolean;
    /** Listener key for the Vision dock host settings subscription. */
    _ytpVisionDockHostSettingsKey?: symbol | null;
    _ytConfigHacks?: Set<(config: Record<string, unknown>) => void>;
    YouTubeUtils: YouTubeUtils;
    YouTubeSafeDOM: YouTubeSafeDOM;
    /** Legacy escape-HTML helper some modules still probe for. */
    YouTubeSecurityUtils?: { escapeHtml?: (value: string) => string };
    YouTubePlusErrorBoundary: YouTubeErrorBoundary;
    YouTubePlusPerformance: YouTubePerformance;
    YouTubePlusLogger: YouTubePlusLogger;
    YouTubePlusI18n: YouTubePlusI18n;
    YouTubePlusEventDelegation: YouTubePlusEventDelegation | undefined;
    YouTubePlusDOMCache: YouTubeDOMCache;
    YouTubePlusMutationCoordinator: YouTubePlusMutationCoordinatorAPI | undefined;
    YouTubePlusMusic: {
      saveSettings?(settings: Record<string, unknown>): void;
      applySettingsChanges?(): void;
      [key: string]: unknown;
    };
    YouTubePlusStats: YouTubePlusStats;
    YouTubePlusZoom: YouTubePlusZoom;
    YouTubePlusPip: YouTubePlusPip;
    YouTubePlusThumbnail: YouTubePlusThumbnail;
    YouTubePlusShorts: YouTubePlusShorts;
    YouTubePlusPlayall: YouTubePlusPlayall;
    YouTubePlusEnhanced: YouTubePlusEnhanced;
    YouTubePlusPlaylistSearch: YouTubePlusPlaylistSearch;
    YouTubePlusReport: YouTubePlusReport;
    YouTubePlusTimeLoop: YouTubePlusTimeLoop;
    YouTubePlusTimeResume: YouTubePlusTimeResume;
    YouTubePlusComment: YouTubePlusComment;
    YouTubePlusUpdate: YouTubePlusUpdate;
    YouTubePlusEndscreen: YouTubePlusEndscreen;
    YouTubePlusPerformanceMode: YouTubePlusPerformanceMode;
    YouTubePlusAnimations: YouTubePlusAnimations;
    YouTubePlusTimecode: YouTubePlusTimecode;
    YouTubePlusVoting: YouTubePlusVoting;
    YouTubePlusAdBlocker: YouTubePlusAdBlocker;
    YouTubePlusHostPolicy: YouTubePlusHostPolicy;
    YouTubePlusDownload: YouTubePlusDownload;
    YouTubePlusDownloadButton: {
      createDownloadButtonManager: (config: Record<string, unknown>) => {
        refreshDownloadButton(): void;
        addDownloadButton(controls?: HTMLElement): void;
      };
      refreshVisibility?(enabled: boolean): void;
      removeClassicButtons?(): void;
      injectStyles?(): void;
      DESCRIPTOR?: YouTubePlusFeatureDescriptor;
      rebuildDownloadDropdown?(): void;
    };
    YouTubePlus: YouTubePlusPublicApi;
    YouTubePlusBasic: YouTubePlusBasic;
    YouTubePlusMain: YouTubePlusMain;
    YouTubePlusScreenshot: YouTubePlusScreenshot;
    YouTubePlusFeatureRegistry: YouTubePlusFeatureRegistry;
    YouTubePlusSettingsHost: YouTubePlusSettingsHost;
    YouTubePlusPlayerActionHost: YouTubePlusPlayerActionHost;
    YouTubePlusPopoverController: YouTubePlusPopoverController;
    YouTubePlusVisionDockHost: YouTubePlusVisionDockHost;
    YouTubePlusSpeedControl: YouTubePlusSpeedControl;
    YouTubePlusSettingsHelpers: YouTubePlusSettingsHelpers;
    YouTubePlusSettingsStore: YouTubePlusSettingsStore;
    YouTubePlusModalHandlers: YouTubePlusModalHandlers;
    YouTubePlusModalDownloadHandlers: YouTubePlusModalDownloadHandlers;
    YouTubePlusSettingsModal: YouTubePlusSettingsModal;
    YouTubePlusDesignSystem: YouTubePlusDesignSystem;
    YouTubePlusCleanupManager: CleanupManager;
    YouTubePlusConfig: YouTubePlusConfig;
    YouTubePlusDebug: YouTubePlusDebug;
    YouTubePlusScrollManager:
      | {
          addScrollListener(
            el: Element,
            handler: () => void,
            opts?: Record<string, unknown>
          ): () => void;
          removeAllListeners?(el: Element): void;
          size(): number;
        }
      | undefined;
    YouTubePlusConstants?: {
      DOWNLOAD_SITES: {
        EXTERNAL_DOWNLOADER: { name: string; url: string };
        [key: string]: { name: string; url: string };
      };
    };
    YouTubePlusStyleResources?: Record<string, unknown>;

    // Legacy aliases (same object, kept for backward compat)
    YouTubeErrorBoundary: YouTubeErrorBoundary;
    YouTubePerformance: YouTubePerformance;
    YouTubeDOMCache: YouTubeDOMCache;
    YouTubeMusic: {
      saveSettings?(settings: Record<string, unknown>): void;
      applySettingsChanges?(): void;
      [key: string]: unknown;
    };
    AdBlocker: YouTubePlusAdBlocker;

    // Backward-compat bridges and short aliases with real consumers in src
    // and tests.
    YouTubePlusSafeDOM: YouTubeSafeDOM;
    YouTubePlusUtils: YouTubeUtils;
    YouTubeStats: YouTubePlusStats;
    waitForElement: YouTubePlusDOMCache['waitForElement'];

    // Secondary / back-compat facades
    YouTubeTrustedTypes: {
      policyName: string;
      isSupported: boolean;
      getPolicy: () => ReturnType<typeof trustedTypes.createPolicy> | null;
      createHTML: (html: string) => string;
      policy?: ReturnType<typeof trustedTypes.createPolicy> | null;
    };
    YouTubePlusTrustedTypes: typeof YouTubeTrustedTypes;
    YouTubePlusI18nLoader: {
      loadTranslations: (lang?: string) => Promise<Record<string, string>>;
    };
    ID3Writer: new (buffer?: ArrayBuffer) => {
      setFrame: (
        name: string,
        value:
          | string
          | number
          | ArrayBuffer
          | unknown[]
          | { type: number; data: ArrayBuffer | unknown[]; description?: string }
      ) => unknown;
      addFrame: (name: string, value: unknown) => unknown;
      addTag: () => unknown;
      getTag: () => unknown;
      /** Getter property in id3-writer, not a method. */
      readonly arrayBuffer: ArrayBuffer;
    };

    // Internal helpers
    _ytplusCreateHTML: (html: string) => string;
    youtubePlus: YouTubePlusConfig;
    _ytpSettingsStoreStorageKey?: symbol | null;
    _ytpSettingsStoreUpdateKey?: symbol | null;
    /** GM_addValueChangeListener handle for the shared settings blob. */
    _ytpSettingsStoreGmListenerId?: number;

    // Diagnostics
    _timecodeModuleInitialized?: boolean;
    __ytpDevMode?: boolean;
    __ytpDebug__?: boolean;
    __ytpDiagnostics?: Function;
    __ytpVideoStatsModuleInit?: boolean;
    __ytpChannelStatsModuleInit?: boolean;
    __ytpTimeInitDone__?: boolean;
    __ytpMainBootDone__?: boolean;
    _enhancedInitialized?: boolean;
    _playlistSearchInitialized?: boolean;
    __ytp_history_wrapped?: boolean;
    /** Set by the unit-test harness; gates facade.testHooks exposure (utils.js). */
    __YTP_TEST_HOOKS__?: true;
    YTP_DEBUG?: boolean;

    // YouTube page globals (ytcfg, ytInitialData, ytInitialPlayerResponse
    // live in types/youtube.d.ts)
    yt?: { config_?: Record<string, unknown> };
    ytplayer?: Record<string, unknown>;
    _yt_player?: Record<string, unknown>;
    ID3Writer?: unknown;

    // Greasemonkey / Tampermonkey (also declared in global scope)
    GM?: Record<string, unknown>;
    GM_info?: { script: { version: string; name: string }; scriptMetaStr?: string };
    GM_openInTab?: (url: string) => void;

    // Utility functions installed by src/utils.js
    closestFromAnchor?: (element: Element) => Element | null;
    _querySelector?: (selector: string, context?: Element | Document) => Element | null;
    findContentsRenderer?: (
      element: Element
    ) => { parent: ParentNode; index: number } | null;
    isVideoPlaying?: (element: HTMLMediaElement | null) => boolean;
  }

  interface EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }

  // -------------------------------------------------------------------------
  // Greasemonkey / Tampermonkey globals
  // -------------------------------------------------------------------------

  const unsafeWindow: Window & typeof globalThis;
  function GM_getValue<T = unknown>(key: string, defaultValue?: T): T;
  function GM_setValue(key: string, value: unknown): void;
  /** GM_deleteValue is available in Tampermonkey/Violentmonkey/Greasemonkey. */
  function GM_deleteValue(key: string): void;
  /**
   * Async GM.* API (Greasemonkey 4+ style). Supported alongside the sync
n   * GM_* variants by the owner-capability storage adapter in voting.js.
   */
  const GM: {
    getValue<T = unknown>(key: string, defaultValue?: T): Promise<T>;
    setValue(key: string, value: unknown): Promise<void>;
    deleteValue(key: string): Promise<void>;
    info?: { script: { version: string; name: string } };
  };
  function GM_addStyle(css: string): void;
  function GM_getResourceText(name: string): string | null;
  /**
   * Tampermonkey-specific API used by src/main.js to inject the
   * page-context boot body. Not part of the standard GM_* surface;
   * declared here because main.js depends on it.
   */
  function GM_addElement(tagName: string, attrs?: Record<string, string | undefined>): HTMLElement;
  function GM_addElement(
    parent: Node | string,
    tagName: string,
    attrs?: Record<string, string | undefined>
  ): HTMLElement;
  function GM_xmlhttpRequest(details: {
    method?: string;
    url: string;
    headers?: Record<string, string>;
    data?: string;
    timeout?: number;
    responseType?: 'text' | 'blob' | 'arraybuffer' | 'document' | string;
    withCredentials?: boolean;
    anonymous?: boolean;
    onload?: (response: GMResponseLike) => void;
    onerror?: (error: unknown) => void;
    ontimeout?: () => void;
    onabort?: () => void;
    onprogress?: ((progress: { loaded: number; total: number }) => void) | null;
  }): { abort: () => void };
  function GM_addValueChangeListener(
    key: string,
    callback: (name: string, oldValue: unknown, newValue: unknown, remote: boolean) => void
  ): number;
  function GM_removeValueChangeListener(listenerId: number): void;
  const GM_info: { script: { version: string; name: string }; scriptMetaStr?: string };

  // -------------------------------------------------------------------------
  // Runtime globals installed by src/utils.js.
  // -------------------------------------------------------------------------

  var trustedTypes: {
    createPolicy: (name: string, rules: {
      createHTML?: (input: string) => string;
      createScriptURL?: (input: string) => string;
      createScript?: (input: string) => string;
    }) => {
      createHTML: (input: string) => string;
      createScriptURL: (input: string) => string;
      createScript: (input: string) => string;
    };
    getPolicy: (name: string) => unknown;
    defaultPolicy: unknown;
  } | undefined;
  var WeakRef: typeof WeakRef;

  // Standalone global value declarations so JS code can reference
  // these directly without `window.`. TS needs the type (interface
  // above) and a value declaration (var below).
  var YouTubeUtils: YouTubeUtils;
  var YouTubePlusLogger: YouTubePlusLogger;
  var YouTubePerformance: YouTubePerformance;
  var YouTubePlusPerformance: YouTubePerformance;
  var YouTubeErrorBoundary: YouTubeErrorBoundary;
  var YouTubePlusErrorBoundary: YouTubeErrorBoundary;
  var YouTubePlusI18n: YouTubePlusI18n;
  var YouTubePlusEventDelegation: YouTubePlusEventDelegation;
  var YouTubeDOMCache: YouTubeDOMCache;
  var YouTubePlusDOMCache: YouTubeDOMCache;
  var YouTubePlusCleanupManager: CleanupManager;
  var YouTubeSafeDOM: YouTubeSafeDOM;
  var YouTubePlusMutationCoordinator: YouTubePlusMutationCoordinatorAPI;
  var YouTubePlusDesignSystem: YouTubePlusDesignSystem;
  var YouTubePlusSettingsStore: YouTubePlusSettingsStore;
  var YouTubePlusEnhanced: YouTubePlusEnhanced;
  var YouTubePlusPlaylistSearch: YouTubePlusPlaylistSearch;
  var YouTubePlusReport: YouTubePlusReport;
  var YouTubePlusTimeLoop: YouTubePlusTimeLoop;
  var YouTubePlusTimeResume: YouTubePlusTimeResume;
  var YouTubePlusStats: YouTubePlusStats;

  // Runtime globals installed by src/utils.js (compatibility surface).
  function closestFromAnchor(element: Element): Element | null;
  function _querySelector(selector: string, context?: Element | Document): Element | null;
  function findContentsRenderer(element: Element): {
    parent: ParentNode;
    index: number;
  } | null;
  function isVideoPlaying(element: HTMLMediaElement | null): boolean;
}
