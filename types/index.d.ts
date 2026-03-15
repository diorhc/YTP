/**
 * Type definitions for YouTube+ userscript
 */

/**
 * YouTubeUtils global namespace
 */
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
  // DOM helpers
  $: (sel: string, ctx?: Element | Document) => Element | null;
  $$: (sel: string, ctx?: Element | Document) => Element[];
  byId: (id: string) => Element | null;
  // Translation helpers
  t: (key: string, params?: Record<string, string | number>) => string;
  i18n?: YouTubePlusI18n;
  getLanguage?: () => string;
  // Additional utilities
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

/**
 * Error Boundary API
 */
interface YouTubeErrorBoundary {
  // Implementations in the codebase use plain Function wrappers; allow Function to reduce noise
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
}

/**
 * Performance Monitoring API
 */
interface YouTubePerformance {
  mark: (name: string) => void;
  measure: (name: string, startMark: string, endMark?: string) => number;
  // Implementations return generic Function wrappers; be permissive here
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

/**
 * Greasemonkey/Tampermonkey API
 */
declare const unsafeWindow: Window & typeof globalThis;

// Common Greasemonkey/Tampermonkey convenience APIs
declare function GM_getValue<T = any>(key: string, defaultValue?: T): T;
declare function GM_setValue(key: string, value: any): void;
declare function GM_addStyle(css: string): void;
declare function GM_getResourceText(name: string): string | null;
declare function GM_xmlhttpRequest(details: {
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
declare function GM_addValueChangeListener(
  key: string,
  callback: (name: string, oldValue: any, newValue: any, remote: boolean) => void
): number;
declare function GM_removeValueChangeListener(listenerId: number): void;
declare const GM_info: { script: { version: string; name: string }; scriptMetaStr?: string } | any;

/**
 * Extended DOM types for better type safety
 */
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

/**
 * YouTube+ specific window extensions
 */
interface YouTubePlusConfig {
  enabled: boolean;
  downloaders: {
    y2mate: boolean;
    xbbuddy: boolean;
  };
  [key: string]: any;
}

interface YouTubePlusDebug {
  utils: any;
  state: any;
  [key: string]: any;
}

/**
 * YouTube+ I18n System
 */
interface YouTubePlusI18n {
  t: (key: string, params?: Record<string, string | number>) => string;
  getLanguage: () => string;
  loadTranslations: (lang?: string) => Promise<void>;
  isReady: () => boolean;
  [key: string]: any;
}

/**
 * YouTube+ Logger
 */
interface YouTubePlusLogger {
  error: (module: string, message: string, data?: any) => void;
  warn: (module: string, message: string, data?: any) => void;
  info: (module: string, message: string, data?: any) => void;
  debug: (module: string, message: string, data?: any) => void;
  setLevel: (level: 'error' | 'warn' | 'info' | 'debug') => void;
  getLevel: () => string;
  getRecent: (count?: number, filterLevel?: string) => any[];
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

/**
 * YouTube+ Module Registry
 */
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

/**
 * YouTube+ Lazy Loader
 */
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

/**
 * YouTube+ Event Delegation
 */
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
  getStats: () => any;
}

/**
 * YouTube+ Security Utils
 */
interface YouTubeSecurityUtils {
  isValidVideoId: (id: string) => boolean;
  isValidChannelId: (id: string) => boolean;
  isYouTubeUrl: (url: string) => boolean;
  sanitizeText: (text: string) => string;
  escapeHtml: (text: string) => string;
  createSafeHTML: (html: string) => any;
  setInnerHTMLSafe: (el: Element, html: string) => void;
  setTextContentSafe: (el: Element, text: string) => void;
  setAttributeSafe: (el: Element, attr: string, value: string) => void;
  validateApiResponse: (data: any, requiredFields: string[]) => boolean;
  securedFetch: (url: string, options?: RequestInit) => Promise<Response>;
  [key: string]: any;
}

/**
 * YouTube+ DOM Cache
 */
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

/**
 * YouTube+ Settings Helpers
 */
interface YouTubePlusSettingsHelpers {
  createSettingsSidebar: (t: Function) => string;
  [key: string]: any;
}

/**
 * YouTube+ Modal Handlers
 */
interface YouTubePlusModalHandlers {
  setSettingByPath: (settings: object, path: string, value: any) => void;
  initializeDownloadSites: (settings: object) => void;
  toggleDownloadSiteControls: (settings: object) => void;
  safelySaveSettings: (settings: object) => void;
  createFocusTrap: (container: HTMLElement) => () => void;
  [key: string]: any;
}

/**
 * Global declarations
 */
declare global {
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
    ytcfg?: {
      get: (key: string) => any;
      data_?: Record<string, any>;
      [key: string]: any;
    };
    yt?: {
      config_?: Record<string, any>;
      [key: string]: any;
    };
    [key: string]: any;
  }

  // Fix for Node.js vs Browser timer types
  // Allow both browser number IDs and NodeJS Timeout objects
  // Using a union reduces TS errors where code expects number but runtime may return Timeout
  type TimerId = number | ReturnType<typeof setTimeout> | any;
  type IntervalId = number | ReturnType<typeof setInterval> | any;

  // Some runtime globals that can be present in various environments
  declare var trustedTypes: any;
  declare var WeakRef: any;
  declare var unsafeWindow: any;

  // Provide minimal DOM augmentation helpers
  interface Document {
    webkitFullscreenElement?: Element | null;
    // Prefer HTMLElement results for queries in this userscript codebase
    querySelector(selectors: string): HTMLElement | null;
    querySelectorAll(selectors: string): NodeListOf<HTMLElement>;
  }

  // Add common properties to Element to reduce need for casts when code confidently
  // treats querySelector results as HTMLElement. This is intentionally permissive
  // to reduce type noise for the userscript codebase that frequently accesses
  // properties on elements without explicit casts.
  interface Element {
    // styling
    style?: CSSStyleDeclaration;
    // form values
    value?: string;
    // text content
    innerText?: string;
    textContent?: string;
    // template/content
    content?: any;
    // dataset
    dataset?: DOMStringMap;
    // click handler shortcut
    onclick?: ((this: HTMLElement, ev?: Event) => any) | null;
    // layout helpers
    offsetParent?: HTMLElement | null;
    // editable
    isContentEditable?: boolean;
    // arbitrary known custom properties used in project
    [key: string]: any;
  }

  // Minimal Node augmentation to align with relaxed Element definitions used above
  interface Node {
    textContent?: string | null;
  }

  // Extend cleanup manager to accept both number and NodeJS.Timeout
  interface CleanupManager {
    registerObserver: (observer: MutationObserver) => MutationObserver;
    registerListener: (
      target: EventTarget | Document | Window,
      event: string,
      fn: EventListener | EventListenerObject,
      options?: AddEventListenerOptions | boolean
    ) => symbol | null;
    registerInterval: (id: TimerId) => TimerId;
    registerTimeout: (id: TimerId) => TimerId;
    registerAnimationFrame: (id: number) => number;
    cleanup: () => void;
  }
}

export {};
