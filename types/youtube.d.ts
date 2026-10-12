/**
 * YouTube page-object type definitions.
 *
 * Shared types for the watch-page player element, YouTube's Polymer custom
 * elements and the page globals the userscript reads. `types/index.d.ts`
 * keeps the module facades; the YouTube host-page objects live here so
 * Gemini and GLM share one definition.
 *
 * Conventions:
 *   - Every member is optional: the player API and the page globals are
 *     absent on non-watch routes and before the page finishes booting.
 *   - Members the readers use are typed to the exact shape; route-dependent
 *     bags that are read through dynamic paths stay permissive records, and
 *     the caller narrows the fields it uses.
 */

export {};

declare global {
  /**
   * The YouTube watch-page player element (`#movie_player`). Only the methods
   * the userscript calls are listed; the page player is not an
   * `HTMLVideoElement`.
   */
  interface YtPlayerElement extends HTMLElement {
    getPlayerResponse?(): PlayerResponse | null;
    getVideoData?(): YtVideoData;
    getProgressState?(): YtProgressState;
    setOption?(module: string, option: string, value: unknown): void;
    getOption?(module: string, option?: string, value?: unknown): unknown;
    seekTo?(seconds: number, allowSeekAhead?: boolean): void;
    playVideo?(): void;
    pauseVideo?(): void;
    getCurrentTime?(): number;
    getDuration?(): number;
    getPlaybackQuality?(): string;
    getAvailableQualityLevels?(): string[];
    setPlaybackQuality?(quality: string): void;
    setPlaybackQualityRange?(start: string, end?: string): void;
    togglePictureInPicture?(): Promise<void> | void;
  }

  /** `getVideoData()` payload; `video_id` is the field the userscript reads. */
  interface YtVideoData {
    video_id?: string;
    title?: string;
    author?: string;
    length_seconds?: string;
  }

  /** `getProgressState()` payload; `current` and `duration` are in seconds. */
  interface YtProgressState {
    current?: number;
    duration?: number;
    number?: number;
  }

  /**
   * A YouTube Polymer custom element. The tabview core patches lifecycle,
   * observer and data hooks on the element prototype, then reads the Polymer
   * data members. Patched members are created from runtime names
   * (`attached498`, `urlChanged`, `_dataChanged496`, ...), which cannot be
   * listed, so the index signature covers them.
   */
  interface YtPolymerElement extends HTMLElement {
    is?: string;
    data?: unknown;
    __data?: unknown;
    hostElement?: Element;
    inst?: YtPolymerElement;
    polymerController?: YtPolymerElement;
    useSignals?: boolean;
    signalProxy?: { signalCache?: Record<string, unknown> };
    attached?(): void;
    detached?(): void;
    ready?(): void;
    dataChanged?(): void;
    childrenChanged?(): void;
    _createPropertyObserver?(path: string, methodName: string, dynamicFn?: boolean): void;
    setWithPath?(path: string, value: unknown): void;
    notifyPath?(path: string, value?: unknown): void;
    [key: string]: unknown;
  }

  /**
   * The page config object (`ytcfg`). `get` carries the locale and InnerTube
   * string keys the userscript reads; `data_` is a dynamic config bag whose
   * fields are read as-is.
   */
  interface YtPageConfig {
    get?(key: string): string | undefined;
    data_?: Record<string, unknown>;
  }

  /**
   * The raw `ytInitialData` boot payload. Its shape depends on the route and
   * is read through dynamic paths, so it stays a permissive record; callers
   * narrow the fields they use.
   */
  type YtInitialData = Record<string, unknown>;

  /** A YouTube command metadata block (`webCommandMetadata` carries the URL). */
  interface YtCommandMetadata {
    webCommandMetadata?: { url?: string; webPageType?: string };
  }

  /**
   * A YouTube navigation endpoint: one target endpoint plus its command
   * metadata. The tabview core reads the watch / browse / search targets.
   */
  interface YtNavigationEndpoint {
    commandMetadata?: YtCommandMetadata;
    watchEndpoint?: { videoId?: string };
    browseEndpoint?: { browseId?: string };
    searchEndpoint?: { query?: string };
    urlEndpoint?: { url?: string };
  }

  /** Page globals installed by YouTube before the userscript boots. */
  var ytInitialData: YtInitialData | undefined;
  var ytInitialPlayerResponse: PlayerResponse | undefined;
  var ytcfg: YtPageConfig | undefined;
}
