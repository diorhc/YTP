/**
 * YouTube+ Userscript — Global Type Definitions
 *
 * Canonical type surface for `window.*` properties installed by the
 * ~37 ES2020 modules concatenated into youtube.user.js. This file
 * is the single source of truth for the global namespace; the
 * legacy src/types.d.ts (which duplicated and diverged from this
 * file) has been removed.
 *
 * Conventions:
 *   - Interfaces use the runtime global name (YouTubeUtils, not
 *     YouTubeUtilsAPI) so `var X: X` declarations and `Window`
 *     property types all reference the same identifier.
 *   - Where two source files declared overlapping interfaces, the
 *     more specific definition wins. The previous src/types.d.ts
 *     generally had narrower types than the catch-all entries here.
 *   - Every interface that also appears on `Window` lives in one
 *     place. Property additions are made to the interface, not
 *     duplicated into the Window declaration.
 *   - `[key: string]: any` catch-alls are kept on `Window` and
 *     Tampermonkey API types where the runtime surface is dynamic.
 */

export {};

declare global {
  // -------------------------------------------------------------------------
  // YouTubeUtils (utils.js) — canonical boot shorthand + module surface.
  // -------------------------------------------------------------------------

  interface CleanupManager {
    registerObserver(
      observer: MutationObserver | IntersectionObserver | ResizeObserver,
      el?: Element
    ): MutationObserver | IntersectionObserver | ResizeObserver;
    registerListener(
      target: EventTarget,
      ev: string,
      fn: EventListenerOrEventListenerObject,
      opts?: AddEventListenerOptions | boolean
    ): symbol | null;
    registerInterval(id: ReturnType<typeof setInterval> | number): ReturnType<typeof setInterval> | number;
    unregisterInterval?(id: ReturnType<typeof setInterval> | number): void;
    registerTimeout(id: ReturnType<typeof setTimeout> | number): ReturnType<typeof setTimeout> | number;
    registerAnimationFrame(id: number): number;
    unregisterAnimationFrame?(id: number): void;
    register(cb: () => void): void;
    unregister?(cb: () => void): void;
    unregisterObserver?(observer: MutationObserver | IntersectionObserver | ResizeObserver): void;
    unregisterListener?(key: symbol): void;
    cleanup(): void;
    disconnectForElement?(el: Element): void;
    disconnectObserver?(observer: MutationObserver | IntersectionObserver | ResizeObserver): void;
    getListenerStats?(): { active: number; registeredTotal: number };
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
    load(): Record<string, unknown>;
    save(settings: Record<string, unknown>): void;
    get(path: string): unknown;
    set(path: string, value: unknown): void;
  }

  interface YouTubeUtils {
    // ----- DOM helpers -----
    $: (selector: string, ctx?: Element | Document) => Element | null;
    $$: (selector: string, ctx?: Element | Document) => Element[];
    byId: (id: string) => Element | null;
    querySelector?: (selector: string, ctx?: Element | Document) => Element | null;
    querySelectorAll?: (selector: string, ctx?: Element | Document) => Element[];

    // ----- Canonical module boot shorthand (see utils.js) -----
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
    /**
     * Canonical timer wrapper used by time.js and basic.js for any
     * long-lived (>= 1s) setTimeout that should participate in the
     * central cleanupManager registry. The bare `setTimeout` is
     * kept as the safe fallback in callers — see `timeSetTimeout_`
     * in time.js — so a missing wrapper can never silently drop
     * the scheduled callback.
     */
    setTimeout_?: (handler: (...args: unknown[]) => void, ms?: number) => unknown;
    onDomReady: (cb: () => void) => void;

    // ----- Utilities -----
    debounce: <T extends (...args: any[]) => any>(
      fn: T,
      ms: number,
      options?: { leading?: boolean }
    ) => T & { cancel: () => void; destroy?: () => void };
    throttle: <T extends (...args: any[]) => any>(fn: T, limit: number) => T;
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
    createHTML: (html: string) => string;
    logError: (module: string, message: string, error: Error | unknown) => void;
    logSuppressed: (error: unknown, module: string, message?: string) => void;
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
    on: (
      target: EventTarget,
      event: string,
      handler: (e: any) => void,
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

    // ----- Shared style injection (utils.js) -----
    injectModuleStyles: (id: string, css: string, target?: Element) => void;

    // ----- Safe localStorage (utils.js) -----
    safeLS: {
      getItem: (k: string, def?: string | null) => string | null;
      setItem: (k: string, v: string) => boolean;
      removeItem: (k: string) => void;
    };

    // ----- Storage -----
    storage?: {
      get<T = unknown>(key: string, defaultValue?: T): T;
      set(key: string, value: unknown): boolean;
      remove(key: string): void;
    };

    // ----- Caching / querying -----
    domCache?: YouTubeDOMCache;
    scopedCache?: unknown;
    selectors?: unknown;
    batchQuery?: (...args: any[]) => any;
    waitFor?: (...args: any[]) => any;

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
    SettingsManager?: SettingsManagerAPI;
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
  // YouTubeErrorBoundary (error-boundary.js) — canonical owner.
  //   The same shape is also surfaced on YouTubePlusLogger as a
  //   back-compat bridge (see logger.js).
  // -------------------------------------------------------------------------

  interface YouTubeErrorBoundaryMethods {
    withErrorBoundary: (
      fn: (...args: any[]) => unknown,
      context?: string
    ) => (...args: any[]) => unknown;
    withAsyncErrorBoundary: (
      fn: (...args: any[]) => Promise<unknown>,
      context?: string
    ) => (...args: any[]) => Promise<unknown>;
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

  // -------------------------------------------------------------------------
  // YouTubePerformance (performance.js)
  // -------------------------------------------------------------------------

  interface YouTubePerformance {
    mark(name: string): void;
    measure(name: string, startMark: string, endMark?: string): number;
    timeFunction<T extends (...args: unknown[]) => unknown>(name: string, fn: T): T;
    timeAsyncFunction<T extends (...args: unknown[]) => unknown>(name: string, fn: T): T;
    recordMetric(name: string, value: number, metadata?: Record<string, unknown>): void;
    getStats(metricName?: string): Record<string, unknown> | null;
    exportMetrics(): string;
    exportToFile(filename?: string): boolean;
    clearMetrics(): void;
    monitorMutations(element: Element, name: string): MutationObserver | null;
    getPerformanceEntries(type: string): PerformanceEntry[];
    getMemoryUsage(): {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
      usedPercent: string;
    } | null;
    trackMemory(): void;
    checkThresholds(
      thresholds: Record<string, number>
    ): Array<{ metric: string; threshold: number; actual: number; exceeded: number }>;
    aggregateByPeriod(periodMs?: number): Array<Record<string, unknown>>;
    config: {
      enabled: boolean;
      sampleRate: number;
      storageKey: string;
      metricsRetention: number;
      enableConsoleOutput: boolean;
      logLevel: string;
    };
    RAFScheduler: { schedule(callback: () => void): () => void; cancelAll(): void };
    LazyLoader: {
      create(options: Record<string, unknown>): {
        observe(el: Element): void;
        unobserve(el: Element): void;
        disconnect(): void;
      };
      disconnectAll(): void;
    };
    DOMBatcher: {
      batch(container: Element, elements: Element[]): void;
      flush(): void;
      clear(container: Element): void;
    };
    ElementCache: {
      get(el: Element, key: string): unknown;
      set(el: Element, key: string, val: unknown): void;
      has(el: Element, key: string): boolean;
      delete(el: Element, key: string): void;
    };
  }

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
  // YouTubePlusLogger (logger.js) — canonical owner.
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
  // YouTubePlusConfig — debug / performance tuning flags.
  // -------------------------------------------------------------------------

  interface YouTubePlusConfig {
    enabled: boolean;
    downloaders: { y2mate: boolean; xbbuddy: boolean };
    debug?: boolean;
    performance?: { sampleRate?: number };
    performanceSampleRate?: number;
    perfSampleRate?: number;
    settings?: Record<string, unknown>;
    rebuildDownloadDropdown?: () => void;
  }

  interface YouTubePlusDebug {
    version: string;
    cacheSize: () => number;
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

  interface YouTubeStatsHelpers {
    extractViews?: () => Record<string, unknown>;
    extractLikes?: () => Record<string, unknown>;
    extractDislikes?: () => Record<string, unknown>;
    extractComments?: () => Record<string, unknown>;
    extractSubscribers?: () => Record<string, unknown>;
    extractThumbnail?: () => Record<string, unknown>;
    extractTitle?: () => Record<string, unknown>;
    extractAuthor?: () => Record<string, unknown>;
    getDurationFromSources?: (apiStats: unknown, pageStats: unknown) => string | null;
    getCountryFromSources?: (apiStats: unknown, pageStats: unknown) => string | null;
    getMonetizationFromSources?: (apiStats: unknown, pageStats: unknown, t: unknown) => string | null;
    formatNumber?: (n: number) => string;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusRegistry (module-registry.js) + LazyLoader
  // -------------------------------------------------------------------------

  interface YouTubePlusRegistry {
    register: (name: string, moduleExport: any) => void;
    get: (name: string) => any;
    has: (name: string) => boolean;
    onReady: (name: string, callback: (mod: any) => void) => void;
    list: () => string[];
    getStats: () => any;
    unregister: (name: string) => void;
    clear: () => void;
    lazyLoader: YouTubePlusLazyLoader;
  }

  interface YouTubePlusLazyLoader {
    LazyLoader: Record<string, unknown> | null;
    _entries: Map<string, { fn: Function; options: any; loaded: boolean }>;
    register: (
      name: string,
      fn: Function,
      options?: {
        priority?: number;
        delay?: number;
        dependencies?: string[];
        shouldLoad?: () => boolean;
      }
    ) => void;
    load: (name: string) => Promise<boolean>;
    loadAll: () => Promise<number>;
    loadOnIdle: (timeout?: number) => void;
    isLoaded: (name: string) => boolean;
    getStats: () => any;
    clear: () => void;
    retryBlockedModules: () => Promise<number>;
    attachNavRetry: () => void;
    getStatus: () => Record<string, string>;
    getAllEntries: () => Array<{ name: string; loaded: boolean; options: any }>;
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
    ) => void;
    undelegate: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function
    ) => void;
    on: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function,
      options?: object
    ) => void;
    off: (
      parent: Element | Document,
      eventType: string,
      selector: string,
      handler: Function
    ) => void;
    getStats: () => any;
  }

  // -------------------------------------------------------------------------
  // YouTubeSecurityUtils (back-compat shim from safe-dom.js)
  // -------------------------------------------------------------------------

  interface YouTubeSecurityUtils {
    /** @deprecated Use the canonical YouTubeSafeDOM surface. */
    isValidVideoId: (id: string) => boolean;
    /** @deprecated Sanitize via the HTML allowlist path instead. */
    sanitizeText: (text: string) => string;
    /** @deprecated Use `YouTubeSafeDOM.escapeHTML` directly. */
    escapeHtml: (text: string) => string;
  }

  // -------------------------------------------------------------------------
  // YouTubeSafeDOM (safe-dom.js) — canonical safe HTML / sanitization.
  // -------------------------------------------------------------------------

  interface YouTubeSafeDOM {
    createHTML(html: string): string;
    createSafeHTML(html: string): string;
    createFragment(html: string): DocumentFragment;
    sanitizeHTML(html: string): string;
    setHTML(element: Element, html: string, options?: { sanitize?: boolean }): void;
    renderTemplateClone(element: Element, html?: string): void;
    setText(element: Element, text: string): void;
    escapeHTML(text: string): string;
    createTrustedHTML(html: string): string;
    createTrustedScriptURL(url: string): string;
    createTrustedScript(value: string): string;
    createTrustedInlineScript(value: string): string;
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
  // YouTubeDOMCache (dom-cache.js) — canonical DOM query / wait / cache.
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
    getStats(): { size: number; multiSize: number; enabled: boolean };
    destroy(): void;

    // Aliases
    query(selector: string, ctx?: Element | Document): Element | null;
    queryAll(selector: string, ctx?: Element | Document): Element[];
    byId(id: string): Element | null;
    get(selector: string): Element | null;
    getAll(selector: string): Element[];
    waitForElement(selector: string, timeout?: number): Promise<Element | null>;

    // Internal fields used by the DOMCache class (not part of the
    // public API, but referenced by the wait/retry helpers).
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
    };
    dispose(): void;
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
    createBasicSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    createAdvancedSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    createExperimentalSettingsSection: (settings: Record<string, unknown>, t: Function) => string;
    createVotingSection: (settings: Record<string, unknown>, t: Function) => string;
    getMusicSettings: () => Record<string, unknown>;
    // biome-ignore lint/suspicious/noExplicitAny: catch-all for design system methods with varying signatures
    [key: string]: any;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusSettingsStore (settings-helpers.js canonical store).
  // -------------------------------------------------------------------------

  interface YouTubePlusSettingsStore {
    STORAGE_KEYS: Readonly<{ main: string; all: string; music: string }>;
    DEFAULTS: Readonly<Record<string, unknown>>;
    MUSIC_DEFAULTS: Readonly<Record<string, unknown>>;
    FEATURE_DEFAULTS: Readonly<Record<string, unknown>>;
    KEY_REGISTRY: ReadonlySet<string>;
    load: () => Record<string, any>;
    save: (settings: Record<string, any> | null | undefined) => void;
    get: (path: string, defaultValue?: any) => any;
    set: (path: string, value: any) => boolean;
    update: (path: string, patch: Record<string, any> | any) => boolean;
    hasKey: (key: string) => boolean;
    getFeature: (featureId: string) => Record<string, any>;
    updateFeature: (featureId: string, patch: Record<string, any> | null | undefined) => boolean;
    subscribe: (pathOrFeature: string, callback: (value: any) => void) => () => void;
    getMusicSettings: () => Record<string, any>;
    saveMusicSettings: (settings: Record<string, any>) => Record<string, any>;
    updateMusicSettings: (patch: Record<string, any>) => boolean;
    subscribeMusicSettings: (callback: (value: any) => void) => () => void;
    reset: () => void;
    _internals: any; // biome-ignore lint/suspicious/noExplicitAny: internal implementation detail
  }

  // -------------------------------------------------------------------------
  // YouTubePlusModalHandlers (modal-handlers.js) — settings-modal UI.
  // -------------------------------------------------------------------------

  interface YouTubePlusModalHandlers {
    setSettingByPath: (settings: object, path: string, value: any) => void;
    initializeDownloadSites: (settings: object) => void;
    toggleDownloadSiteControls: (settings: object) => void;
    safelySaveSettings: (settings: object) => void;
    createFocusTrap: (container: HTMLElement) => () => void;
    applySettingLive: (setting: string, context: any) => void;
    handleDownloadSiteToggle: (
      target: HTMLElement,
      key: string,
      settings: any,
      markDirty: Function,
      saveSettings: Function
    ) => void;
    isMusicSetting: (path: string) => boolean;
    handleMusicSettingToggle: (
      target: HTMLElement,
      setting: string,
      showNotification: Function,
      t: Function
    ) => void;
    handleSimpleSettingToggle: (
      target: HTMLElement,
      setting: string,
      settings: any,
      context: any,
      markDirty: Function,
      saveSettings: Function,
      modal: HTMLElement
    ) => void;
    handleDownloadSiteInput: (
      target: HTMLElement,
      site: string,
      field: string,
      settings: any,
      markDirty: Function,
      t: Function
    ) => void;
    // Canonical home for settings-modal UI widget helpers (moved from
    // design-system.js, which keeps a lazy back-compat shim).
    modifierComboValues: string[];
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
    }) => () => void;
    [key: string]: unknown;
  }

  // -------------------------------------------------------------------------
  // YouTubePlusDesignSystem (design-system.js) — theme sync, StyleManager,
  // design-system token CSS bundle, and the static CSS registry. Settings
  // modal UI widget helpers used to live here; they have been moved to
  // YouTubePlusModalHandlers. They remain available on this object as a
  // lazy back-compat bridge.
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
    styleBundles: Record<string, string>;
    getStyle: (id: string) => string;
    resolveTheme: () => 'dark' | 'light';
    syncTheme: () => void;
    repairStyles?: () => void;
    bootstrapStyleBundleIds?: string[];
    bootstrapStaticStyles?: () => void;
    inspectStyles?: () => {
      hostPresent: boolean;
      hostConnected: boolean;
      hostTextLength: number;
      expectedTextLength: number;
      registeredStyleIds: string[];
      textMatchesExpected: boolean;
    };
    // Back-compat bridge (lazy delegation to YouTubePlusModalHandlers):
    modifierComboValues: string[];
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
  }

  interface SubtitleDownloadOptions {
    videoId: string;
    url: string;
    languageCode: string;
    languageName: string;
    isAutoGenerated: boolean;
    format: string;
    translateTo?: string | null;
  }

  interface YouTubePlusDownload {
    downloadVideo(options?: DownloadOptions): Promise<void>;
    getSubtitles(videoId: string): Promise<SubtitleData | null>;
    downloadSubtitle(options: SubtitleDownloadOptions): Promise<void>;
    getVideoId(): string | null;
    getVideoUrl(): string;
    getVideoTitle(): string;
    sanitizeFilename(name: string): string;
    formatBytes(bytes: number): string;
    openModal(): void;
    init(): void;
    DownloadConfig: Record<string, unknown>;
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
    // Kept as catch-all: codebase accesses Element-specific props
    // (click, dataset, style, etc.) via generic Element references.
    [key: string]: any;
  }

  interface Node {
    textContent?: string | null;
    appendChild000<T extends Node>(child: T): T;
    insertBefore000<T extends Node>(newNode: T, refNode: Node | null): T;
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

  interface Window {
    // Core modules
    YouTubeUtils: YouTubeUtils;
    YouTubeErrorBoundary: YouTubeErrorBoundary;
    YouTubePerformance: YouTubePerformance;
    YouTubePlusLogger: YouTubePlusLogger;
    YouTubePlusI18n: YouTubePlusI18n;
    YouTubePlusLazyLoader: YouTubePlusLazyLoader | undefined;
    YouTubePlusEventDelegation: YouTubePlusEventDelegation | undefined;
    YouTubeDOMCache: YouTubeDOMCache;
    YouTubePlusMutationCoordinator: YouTubePlusMutationCoordinatorAPI | undefined;
    YouTubeMusic: {
      observeDocumentBodySafely?(): void;
      checkAndCreateButton?(): void;
      createScrollToTopButton?(): void;
      saveSettings?(settings: Record<string, unknown>): void;
      applySettingsChanges?(): void;
      version?: string;
      [key: string]: unknown;
    };
    YouTubePlusDownload: YouTubePlusDownload;
    YouTubePlusDownloadButton: {
      createDownloadButtonManager: (config: Record<string, unknown>) => {
        refreshDownloadButton(): void;
        addDownloadButton(controls?: HTMLElement): void;
        [key: string]: unknown;
      };
      refreshVisibility?(enabled: boolean): void;
      injectStyles?(): void;
    };
    YouTubePlusErrorRecovery:
      | { attemptRecovery(error: Error, context: Record<string, unknown>): void }
      | undefined;
    YouTubePlusStorage: Record<string, unknown> | undefined;
    YouTubePlus: any; // biome-ignore lint/suspicious/noExplicitAny: dynamic namespace with varying properties
    YouTubePlusSettingsHelpers: YouTubePlusSettingsHelpers;
    YouTubePlusSettingsStore: YouTubePlusSettingsStore;
    YouTubePlusModalHandlers: YouTubePlusModalHandlers;
    YouTubePlusScrollManager:
      | {
          addScrollListener(
            el: Element,
            handler: () => void,
            opts?: Record<string, unknown>
          ): () => void;
          removeAllListeners?(el: Element): void;
        }
      | undefined;
    YouTubePlusConstants?: {
      DOWNLOAD_SITES: {
        EXTERNAL_DOWNLOADER: { name: string; url: string };
        [key: string]: { name: string; url: string };
      };
    };
    YouTubeStatsHelpers?: YouTubeStatsHelpers;
    YouTubePlusChannelStatsHelpers?: Record<string, unknown>;
    YouTubePlusEmbeddedTranslations?: Record<string, unknown>;
    YouTubePlusConfig: YouTubePlusConfig;
    YouTubePlusDebug: YouTubePlusDebug;
    YouTubePlusDesignSystem: YouTubePlusDesignSystem;
    YouTubePlusCleanupManager: CleanupManager;
    YouTubeSafeDOM: YouTubeSafeDOM;

    nextBrowserTick: ((callback?: () => void) => Promise<void>) & { version: number };

    // Internal helpers
    _ytplusCreateHTML: (html: string) => string;
    _ytConfigHacks: Set<(config: Record<string, unknown>) => void>;
    youtubePlus: YouTubePlusConfig;

    // Diagnostics
    _timecodeModuleInitialized?: boolean;
    __ytpDevMode?: boolean;
    __ytp_timers_wrapped?: boolean;
    __ytpDiagnostics?: Function;

    // Browser APIs / page objects
    ytcfg?: { get: (key: string) => any; data_?: Record<string, any>; [key: string]: any };
    yt?: { config_?: Record<string, any>; [key: string]: any };

    /**
     * Global utility installed by src/utils.js. Walks the closest
     * `<a>` ancestors and resolves the matching element.
     */
    closestFromAnchor?: (element: Element) => Element | null;
    /**
     * Global utility installed by src/utils.js. Bypasses the
     * canonical dom-cache and queries the DOM directly.
     */
    _querySelector?: (selector: string, context?: Element | Document) => Element | null;
    /**
     * Global utility installed by src/utils.js. Resolves the parent
     * `<ytd-comment-renderer>` and zero-based child index.
     */
    findContentsRenderer?: (
      element: Element
    ) => { parent: ParentNode; index: number } | null;
    /**
     * Global utility installed by src/utils.js. Reports whether a
     * given HTMLMediaElement is currently playing.
     */
    isVideoPlaying?: (element: HTMLMediaElement | null) => boolean;

    [key: string]: any;
  }

  // -------------------------------------------------------------------------
  // Greasemonkey / Tampermonkey globals
  // -------------------------------------------------------------------------

  const unsafeWindow: Window & typeof globalThis;
  function GM_getValue<T = any>(key: string, defaultValue?: T): T;
  function GM_setValue(key: string, value: any): void;
  function GM_addStyle(css: string): void;
  function GM_getResourceText(name: string): string | null;
  /**
   * Tampermonkey-specific API used by src/main.js to inject the
   * page-context boot body. Not part of the standard GM_* surface;
   * declared here because main.js depends on it.
   */
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
    onload?: (response: any) => void;
    onerror?: (error: any) => void;
    ontimeout?: () => void;
    onabort?: () => void;
    [key: string]: any;
  }): { abort: () => void };
  function GM_addValueChangeListener(
    key: string,
    callback: (name: string, oldValue: any, newValue: any, remote: boolean) => void
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
  var YouTubeErrorBoundary: YouTubeErrorBoundary;
  var YouTubePlusRegistry: YouTubePlusRegistry;
  var YouTubePlusI18n: YouTubePlusI18n;
  var YouTubePlusLazyLoader: YouTubePlusLazyLoader;
  var YouTubePlusEventDelegation: YouTubePlusEventDelegation;
  var YouTubeSecurityUtils: YouTubeSecurityUtils;
  var YouTubeDOMCache: YouTubeDOMCache;
  var YouTubePlusCleanupManager: CleanupManager;
  var YouTubeSafeDOM: YouTubeSafeDOM;
  var YouTubePlusMutationCoordinator: YouTubePlusMutationCoordinatorAPI;
  var YouTubePlusDesignSystem: YouTubePlusDesignSystem;
  var YouTubePlusSettingsStore: YouTubePlusSettingsStore;

  // Runtime globals installed by src/utils.js (compatibility surface).
  function closestFromAnchor(element: Element): Element | null;
  function _querySelector(selector: string, context?: Element | Document): Element | null;
  function findContentsRenderer(element: Element): {
    parent: ParentNode;
    index: number;
  } | null;
  function isVideoPlaying(element: HTMLMediaElement | null): boolean;
}
