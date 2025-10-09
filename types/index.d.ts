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
 * Global declarations
 */
declare global {
    interface Window {
        YouTubeUtils: YouTubeUtils;
        YouTubeErrorBoundary: YouTubeErrorBoundary;
        YouTubePerformance: YouTubePerformance;
        nextBrowserTick: ((callback?: () => void) => Promise<void>) & { version: number };
        _ytplusCreateHTML: (html: string) => string;
        youtubePlus: YouTubePlusConfig;
        YouTubePlusDebug: YouTubePlusDebug;
        _timecodeModuleInitialized?: boolean;
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

export { };
