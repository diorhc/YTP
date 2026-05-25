/**
 * YouTube+ Userscript — Global Type Definitions
 *
 * Provides proper TypeScript interfaces for the public APIs exposed on `window`
 * by each module. Eliminates the need for `@type {any}` casts in JSDoc across
 * the codebase.
 */

declare function GM_addElement(
  tagName: string,
  attributes?: Record<string, string | number | boolean | null | undefined>
): HTMLElement;

// ---------------------------------------------------------------------------
// YouTubeUtils (basic.js / utils.js)
// ---------------------------------------------------------------------------

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
  registerInterval(id: ReturnType<typeof setInterval>): ReturnType<typeof setInterval>;
  registerTimeout(id: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout>;
  registerAnimationFrame(id: number): number;
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

interface YouTubeUtilsAPI {
  // DOM helpers
  $: (selector: string, ctx?: Element | Document) => Element | null;
  $$: (selector: string, ctx?: Element | Document) => Element[];
  byId: (id: string) => Element | null;

  // Translation
  t: (key: string, params?: Record<string, string | number>) => string;
  onDomReady: (cb: () => void) => void;

  // Utilities
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
  ) => Promise<HTMLElement>;
  sanitizeHTML: (html: string) => string;
  setSafeHTML: (element: Element, html: string, sanitize?: boolean) => void;
  escapeHTMLAttribute: (str: string) => string;
  isValidURL: (url: string) => boolean;
  safeMerge: (
    target: Record<string, unknown>,
    source: Record<string, unknown>
  ) => Record<string, unknown>;
  validateVideoId: (videoId: string) => string | null;
  validatePlaylistId: (playlistId: string) => string | null;
  loadFeatureEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
  isWatchPage?: (urlLike?: string) => boolean;
  isShortsPage?: (urlLike?: string) => boolean;
  isChannelPage?: (urlLike?: string) => boolean;
  formatTime?: (seconds: number) => string;
  logError: (module: string, message: string, error: Error | unknown) => void;
  isStudioPage?: () => boolean;

  // Storage
  storage?: {
    get<T = unknown>(key: string, defaultValue?: T): T;
    set(key: string, value: unknown): boolean;
    remove(key: string): void;
  };

  // Caching / querying
  domCache?: {
    get(selector: string): Element | null;
    getAll(selector: string): Element[];
    [key: string]: unknown;
  };
  scopedCache?: unknown;
  selectors?: unknown;
  batchQuery?: (...args: any[]) => any;
  waitFor?: (...args: any[]) => any;

  // i18n shortcut
  i18n?: YouTubePlusI18nAPI;

  // Observers / schedulers
  ObserverRegistry?: {
    track(key?: string, observer?: unknown): void;
    untrack(key?: string): void;
    loadFeatureEnabled: (featureKey: string, defaultValue?: boolean) => boolean;
  };
  createRetryScheduler?: (...args: unknown[]) => { stop: () => void } | null | undefined;
  createVisibilityAwareInterval?: (
    callback: () => void,
    delay: number
  ) => {
    stop: () => void;
    pause: () => void;
    resume: () => void;
    active: boolean;
  };

  // Managers
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

  // Logger
  logger?: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };

  // Settings key
  SETTINGS_KEY?: string;
  getLanguage: () => string;
}

// ---------------------------------------------------------------------------
// YouTubePlusDownload (download.js)
// ---------------------------------------------------------------------------

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

interface YouTubePlusDownloadAPI {
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

interface SubtitleData {
  videoId: string;
  videoTitle: string;
  subtitles: SubtitleTrack[];
  autoTransSubtitles: SubtitleTrack[];
}

interface SubtitleTrack {
  name: string;
  languageCode: string;
  sourceLanguageCode?: string;
  baseUrl: string;
  url: string;
  isAutoGenerated: boolean;
  translateTo?: string;
}

// ---------------------------------------------------------------------------
// YouTubePerformance (performance.js)
// ---------------------------------------------------------------------------

interface YouTubePerformanceAPI {
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

// ---------------------------------------------------------------------------
// YouTubeErrorBoundary (error-boundary.js)
// ---------------------------------------------------------------------------

interface YouTubeErrorBoundaryMethodsAPI {
  withErrorBoundary(
    fn: (...args: unknown[]) => unknown,
    context?: string
  ): (...args: unknown[]) => unknown;
  withAsyncErrorBoundary(
    fn: (...args: unknown[]) => Promise<unknown>,
    context?: string
  ): (...args: unknown[]) => Promise<unknown>;
  getErrorStats(): {
    totalErrors: number;
    recentErrors: number;
    lastErrorTime: number;
    isRecovering: boolean;
    errorsByType: Record<string, number>;
  };
  clearErrors(): void;
  logError(error: Error, context?: Record<string, unknown>): void;
  getErrorRate(): number;
  config: Record<string, unknown>;
}

interface YouTubeErrorBoundaryAPI extends YouTubeErrorBoundaryMethodsAPI {}

// ---------------------------------------------------------------------------
// YouTubePlusI18n (i18n.js)
// ---------------------------------------------------------------------------

interface YouTubePlusI18nAPI {
  t(key: string, params?: Record<string, string | number>): string;
  getLanguage(): string;
  setLanguage?(lang: string): void;
  onLanguageChange?(callback: () => void): void;
  hasTranslation?(key: string): boolean;
  translations?: Record<string, unknown>;
  loadTranslations?(lang?: string): Promise<boolean>;
  isReady?(): boolean;
}

// ---------------------------------------------------------------------------
// YouTubePlusLogger (logger.js)
// ---------------------------------------------------------------------------

interface YouTubePlusLoggerAPI extends YouTubeErrorBoundaryMethodsAPI {
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
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// YouTubeDOMCache (dom-cache.js)
// ---------------------------------------------------------------------------

interface YouTubeDOMCacheAPI {
  get(selector: string): Element | null;
  getAll(selector: string): Element[];
  querySelector(selector: string, ctx?: Element | Document): Element | null;
  querySelectorAll?(selector: string, ctx?: Element | Document): Element[];
  getElementById?(id: string): Element | null;
  invalidate?(selector?: string): void;
  clear?(): void;
}

// ---------------------------------------------------------------------------
// Global Window augmentation
// ---------------------------------------------------------------------------

interface Scheduler {
  yield(): Promise<void>;
}

declare global {
  interface Window {
    // Core modules
    YouTubeUtils: YouTubeUtilsAPI;
    YouTubeDOMCache: YouTubeDOMCacheAPI;
    YouTubePlusI18n: YouTubePlusI18nAPI;
    YouTubePlusLogger: YouTubePlusLoggerAPI;
    YouTubePerformance: YouTubePerformanceAPI;
    YouTubeErrorBoundary: YouTubeErrorBoundaryAPI;

    // Feature modules
    YouTubePlusDownload: YouTubePlusDownloadAPI;
    YouTubePlusDownloadButton: {
      createDownloadButtonManager: (config: Record<string, unknown>) => {
        refreshDownloadButton(): void;
        addDownloadButton(controls?: HTMLElement): void;
        [key: string]: unknown;
      };
    };
    YouTubeDownload: {
      init(): void;
      openModal(): void;
      getVideoId(): string | null;
      getVideoTitle(): string;
      version: string;
    };
    YouTubePlusLazyLoader: YouTubePlusLazyLoader | undefined;
    YouTubePlusErrorRecovery:
      | { attemptRecovery(error: Error, context: Record<string, unknown>): void }
      | undefined;
    YouTubePlusSecurity: Record<string, unknown> | undefined;
    YouTubePlusStorage: Record<string, unknown> | undefined;
    YouTubePlusPerformance: Record<string, unknown> | undefined;
    YouTubePlusEventDelegation: YouTubePlusEventDelegation | undefined;
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
    YouTubePlusConfig:
      | {
          debug?: boolean;
          performance?: { sampleRate?: number };
          performanceSampleRate?: number;
          perfSampleRate?: number;
        }
      | undefined;

    // Internal helpers
    _ytplusCreateHTML: (s: string) => string;
    _ytConfigHacks: Set<(config: Record<string, unknown>) => void>;
    __ytpDevMode?: boolean;
    youtubePlus?: Record<string, unknown>;

    // Browser APIs
    scheduler?: Scheduler;
  }

  // Element extensions used by main.js
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
  }

  interface Node {
    appendChild000<T extends Node>(child: T): T;
    insertBefore000<T extends Node>(newNode: T, refNode: Node | null): T;
  }

  // Timer ID type alias for clarity
  type TimerId = ReturnType<typeof setInterval>;
}

export {};
