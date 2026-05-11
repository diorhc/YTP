/**
 * Type definitions for YouTube+ userscript
 *
 * All declarations are inside declare global so they are accessible as global
 * types in all JS/TS files when this file is included via tsconfig.
 */

export {};

declare global {
  interface YouTubeUtils {
    logError: (module: string, message: string, error: Error | any) => void;
    debounce: <T extends (...args: any[]) => any>(
      fn: T,
      ms: number,
      options?: { leading?: boolean }
    ) => T & { cancel: () => void };
    throttle: <T extends (...args: any[]) => any>(fn: T, limit: number) => T;
    StyleManager: {
      add: (id: string, css: string) => void;
      remove: (id: string) => void;
      clear: () => void;
    };
    cleanupManager: CleanupManager;
    createElement: (tag: string, props?: object, children?: any[]) => HTMLElement;
    waitForElement: (
      selector: string,
      timeout?: number,
      parent?: HTMLElement
    ) => Promise<HTMLElement>;
    storage: {
      get: <T = any>(key: string, defaultValue?: T) => T;
      set: (key: string, value: any) => boolean;
      remove: (key: string) => void;
    };
    $: (sel: string, ctx?: Element | Document) => HTMLElement | null;
    $$: (sel: string, ctx?: Element | Document) => HTMLElement[];
    byId: (id: string) => HTMLElement | null;
    t: (key: string, params?: Record<string, string | number>) => string;
    i18n?: YouTubePlusI18n;
    getLanguage?: () => string;
    logger?: { debug?: Function; info?: Function; warn?: Function; error?: Function };
    sanitizeHTML?: (html: string) => string;
    escapeHTMLAttribute?: (str: string) => string;
    safeMerge?: (target: object, source: object) => object;
    validateVideoId?: (id: string) => boolean;
    validatePlaylistId?: (id: string) => boolean;
    validateChannelId?: (id: string) => boolean;
    validateNumber?: (val: any, min?: number, max?: number) => number | null;
    isValidURL?: (url: string) => boolean;
    retryWithBackoff?: (fn: Function, maxRetries?: number, baseDelay?: number) => Promise<any>;
    createRetryScheduler?: Function;
    ObserverRegistry?: any;
    NotificationManager?: any;
    loadFeatureEnabled?: (key: string, defaultValue?: boolean) => boolean;
    createFeatureToggle?: Function;
    SETTINGS_KEY?: string;
    isStudioPage?: () => boolean;
    channelStatsHelpers?: any;
    EventDelegator?: any;
    DOMCache?: any;
    ScrollManager?: any;
    [key: string]: any;
  }

  interface YouTubeErrorBoundary {
    withErrorBoundary: (fn: Function, context?: string) => Function;
    withAsyncErrorBoundary: (fn: Function, context?: string) => Function;
    getErrorStats: () => {
      totalErrors: number;
      recentErrors: number;
      lastErrorTime: number;
      isRecovering: boolean;
      errorsByType: Record<string, number>;
    };
    clearErrors: () => void;
    logError: (error: Error, context?: object) => void;
    getErrorRate: () => number;
    config: object;
  }

  interface YouTubePerformance {
    mark: (name: string) => void;
    measure: (name: string, startMark: string, endMark?: string) => number;
    timeFunction: (name: string, fn: Function) => Function;
    timeAsyncFunction: (name: string, fn: Function) => Function;
    recordMetric: (name: string, value: number, metadata?: object) => void;
    getStats: (metricName?: string) => any;
    exportMetrics: () => string;
    clearMetrics: () => void;
    monitorMutations: (element: Element, name: string) => MutationObserver | null;
    getPerformanceEntries: (type: string) => PerformanceEntry[];
    config: {
      enabled: boolean;
      sampleRate: number;
      storageKey: string;
      metricsRetention: number;
      enableConsoleOutput: boolean;
    };
  }

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

  interface YouTubePlusConfig {
    enabled: boolean;
    downloaders: { y2mate: boolean; xbbuddy: boolean };
    [key: string]: any;
  }

  interface YouTubePlusDebug {
    utils: any;
    state: any;
    [key: string]: any;
  }

  interface YouTubePlusI18n {
    t: (key: string, params?: Record<string, string | number>) => string;
    getLanguage: () => string;
    loadTranslations: (lang?: string) => Promise<boolean>;
    isReady: () => boolean;
    [key: string]: any;
  }

  interface YouTubePlusLogger {
    error: (module: string, message: string, data?: any) => void;
    warn: (module: string, message: string, data?: any) => void;
    info: (module: string, message: string, data?: any) => void;
    debug: (module: string, message: string, data?: any) => void;
    setLevel: (level: 'error' | 'warn' | 'info' | 'debug') => void;
    getLevel: () => string;
    getRecent: (count?: number, filterLevel?: 'error' | 'warn' | 'info' | 'debug') => any[];
    export: () => string;
    clear: () => void;
    getStats: () => any;
    createLogger: (moduleName: string) => {
      error: (message: string, data?: any) => void;
      warn: (message: string, data?: any) => void;
      info: (message: string, data?: any) => void;
      debug: (message: string, data?: any) => void;
    };
  }

  interface YouTubePlusRegistry {
    register: (name: string, moduleExport: any) => void;
    get: (name: string) => any;
    has: (name: string) => boolean;
    onReady: (name: string, callback: (mod: any) => void) => void;
    list: () => string[];
    getStats: () => any;
    unregister: (name: string) => void;
    clear: () => void;
  }

  interface YouTubePlusLazyLoader {
    LazyLoader: any;
    register: (
      name: string,
      fn: Function,
      options?: { priority?: number; delay?: number; dependencies?: string[] }
    ) => void;
    load: (name: string) => Promise<boolean>;
    loadAll: () => Promise<number>;
    loadOnIdle: (timeout?: number) => void;
    isLoaded: (name: string) => boolean;
    getStats: () => any;
    clear: () => void;
  }

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

  interface YouTubeSecurityUtils {
    isValidVideoId: (id: string) => boolean;
    isValidChannelId: (id: string) => boolean;
    isYouTubeUrl: (url: string) => boolean;
    sanitizeText: (text: string) => string;
    escapeHtml: (text: string) => string;
    createSafeHTML: (html: string) => any;
    setInnerHTMLSafe: (el: Element, html: string, sanitize?: boolean) => void;
    setTextContentSafe: (el: Element, text: string) => void;
    setAttributeSafe: (el: Element, attr: string, value: string) => boolean;
    sanitizeAttribute: (attrName: string, attrValue: string) => string | null;
    validateNumber: (value: any, min?: number, max?: number) => number | null;
    fetchWithTimeout: (url: string, options?: RequestInit, timeout?: number) => Promise<Response>;
    validateJSONSchema: (data: any, schema: any) => boolean;
    RateLimiter: any;
    [key: string]: any;
  }

  interface YouTubeDOMCache {
    get: (selector: string) => Element | null;
    getAll: (selector: string) => Element[];
    querySelector: (sel: string, ctx?: Element | Document) => Element | null;
    querySelectorAll: (sel: string, ctx?: Element | Document) => Element[];
    getElementById: (id: string) => Element | null;
    waitForElement: (selector: string, timeout?: number) => Promise<Element>;
    invalidate: (selector?: string) => void;
    getStats: () => any;
    [key: string]: any;
  }

  interface YouTubePlusSettingsHelpers {
    createSettingsSidebar: (t: Function) => string;
    [key: string]: any;
  }

  interface YouTubePlusModalHandlers {
    setSettingByPath: (settings: object, path: string, value: any) => void;
    initializeDownloadSites: (settings: object) => void;
    toggleDownloadSiteControls: (settings: object) => void;
    safelySaveSettings: (settings: object) => void;
    createFocusTrap: (container: HTMLElement) => () => void;
    [key: string]: any;
  }

  interface CleanupManager {
    registerObserver: (observer: MutationObserver) => MutationObserver;
    registerListener: (
      target: EventTarget | Document | Window,
      event: string,
      handler: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => symbol | null;
    registerTimer: (id: TimerId) => TimerId;
    registerInterval: (id: IntervalId) => IntervalId;
    cleanup: () => void;
    [key: string]: any;
  }

  // Timer helper types
  type TimerId = number | ReturnType<typeof setTimeout> | any;
  type IntervalId = number | ReturnType<typeof setInterval> | any;

  // Greasemonkey/Tampermonkey globals
  const unsafeWindow: Window & typeof globalThis;
  function GM_getValue<T = any>(key: string, defaultValue?: T): T;
  function GM_setValue(key: string, value: any): void;
  function GM_addStyle(css: string): void;
  function GM_getResourceText(name: string): string | null;
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
  const GM_info: { script: { version: string; name: string }; scriptMetaStr?: string } | any;

  // Runtime globals
  var trustedTypes: any;
  var WeakRef: any;

  interface Window {
    YouTubeUtils: YouTubeUtils;
    YouTubeErrorBoundary: YouTubeErrorBoundary;
    YouTubePerformance: YouTubePerformance;
    YouTubePlusLogger: YouTubePlusLogger;
    YouTubePlusRegistry: YouTubePlusRegistry;
    YouTubePlusI18n: YouTubePlusI18n;
    YouTubePlusLazyLoader: YouTubePlusLazyLoader;
    YouTubePlusEventDelegation: YouTubePlusEventDelegation;
    YouTubeSecurityUtils: YouTubeSecurityUtils;
    YouTubePlusSecurity: YouTubeSecurityUtils;
    YouTubeDOMCache: YouTubeDOMCache;
    YouTubeScopedCache: any;
    YouTubeSelectors: any;
    YouTubeStats: any;
    YouTubeMusic: any;
    YouTubePlusDownload: any;
    YouTubePlusDownloadButton: any;
    YouTubeDownload: any;
    YouTubePlus: any;
    YouTubePlusSettingsHelpers: YouTubePlusSettingsHelpers;
    YouTubePlusModalHandlers: YouTubePlusModalHandlers;
    YouTubePlusScrollManager: any;
    YouTubePlusConstants: any;
    YouTubeStatsHelpers: any;
    YouTubePlusChannelStatsHelpers: any;
    YouTubePlusEmbeddedTranslations: any;
    YouTubePlusConfig: YouTubePlusConfig;
    YouTubePlusDebug: YouTubePlusDebug;
    nextBrowserTick: ((callback?: () => void) => Promise<void>) & { version: number };
    _ytplusCreateHTML: (html: string) => string;
    youtubePlus: YouTubePlusConfig;
    _timecodeModuleInitialized?: boolean;
    __ytpDevMode?: boolean;
    __ytp_timers_wrapped?: boolean;
    __ytpDiagnostics?: Function;
    ytcfg?: { get: (key: string) => any; data_?: Record<string, any>; [key: string]: any };
    yt?: { config_?: Record<string, any>; [key: string]: any };
    [key: string]: any;
  }

  interface Document {
    webkitFullscreenElement?: Element | null;
    querySelector(selectors: string): Element | null;
    querySelectorAll(selectors: string): NodeListOf<Element>;
  }

  interface Element {
    [key: string]: any;
  }

  interface Node {
    textContent?: string | null;
  }
}
