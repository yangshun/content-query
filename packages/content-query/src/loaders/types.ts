import type { MaybePromise } from "../shared/types.ts";
import type { RenderedContent } from "../runtime/types.ts";

declare const loaderSourceType: unique symbol;

/** A stored content record, following Astro's build-time DataEntry contract. */
export type DataEntry<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Source = unknown,
> = {
  id: string;
  data: Data;
  body?: string;
  rendered?: RenderedContent;
  filePath?: string;
  digest?: string | number;
  deferredRender?: boolean;
  assetImports?: string[];
  imageImports?: (string | number)[][];
  /** Optional ContentQuery metadata; Astro stores do not retain this extension. */
  source?: Source;
};
/** Source metadata supplied by loaders of individual local files. */
export type FileSource = { filePath: string };
/** Source metadata identifying a record within a shared local file. */
export type FileEntrySource = FileSource & { key: string };
export type DataStore<in Source = unknown> = {
  get<Data extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
  ): DataEntry<Data> | undefined;
  set<Data extends Record<string, unknown>>(entry: DataEntry<Data, Source>): boolean;
  entries(): [string, DataEntry][];
  values(): DataEntry[];
  keys(): string[];
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  addModuleImport(filename: string): void;
};
export type MetaStore = {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  has(key: string): boolean;
  delete(key: string): void;
};
export type LoaderConfig = {
  root: URL;
  srcDir: URL;
  publicDir: URL;
  outDir: URL;
  cacheDir: URL;
  base: string;
  site?: string;
  output: "static" | "server" | "hybrid";
};
export type LoaderLogger = {
  label: string;
  options: {
    level: "debug" | "info" | "warn" | "error" | "silent";
    destination: {
      write(message: {
        label: string | null;
        level: "debug" | "info" | "warn" | "error" | "silent";
        message: string;
        newLine: boolean;
      }): void;
      flush?(): void | Promise<void>;
      close?(): void | Promise<void>;
    };
  };
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  fork(label: string): LoaderLogger;
  flush(): void;
  close(): void;
};
export type LoaderWatchEvents = {
  add: [filename: string];
  change: [filename: string];
  unlink: [filename: string];
  addDir: [filename: string];
  unlinkDir: [filename: string];
  all: [event: string, filename: string];
  error: [cause: Error];
  ready: [];
};
/** Shared filesystem watcher; loader callbacks are serialized and published as complete batches. */
export interface LoaderWatcher {
  on<Event extends keyof LoaderWatchEvents>(
    event: Event,
    listener: (...arguments_: LoaderWatchEvents[Event]) => unknown,
  ): LoaderWatcher;
  once<Event extends keyof LoaderWatchEvents>(
    event: Event,
    listener: (...arguments_: LoaderWatchEvents[Event]) => unknown,
  ): LoaderWatcher;
  off<Event extends keyof LoaderWatchEvents>(
    event: Event,
    listener: (...arguments_: LoaderWatchEvents[Event]) => unknown,
  ): LoaderWatcher;
  removeListener<Event extends keyof LoaderWatchEvents>(
    event: Event,
    listener: (...arguments_: LoaderWatchEvents[Event]) => unknown,
  ): LoaderWatcher;
  removeAllListeners(event?: string): LoaderWatcher;
  add(paths: string | readonly string[]): LoaderWatcher;
  unwatch(paths: string | readonly string[]): LoaderWatcher;
  close(): Promise<void>;
}
export type LoaderContext<in Source = unknown> = {
  collection: string;
  store: DataStore<Source>;
  meta: MetaStore;
  config: LoaderConfig;
  logger: LoaderLogger;
  watcher?: LoaderWatcher;
  /** ContentQuery extension: cancellation for this load attempt. */
  signal?: AbortSignal;
  parseData<Data extends Record<string, unknown>>(options: {
    id: string;
    data: Data;
    filePath?: string;
  }): Promise<Data>;
  renderMarkdown(content: string, options?: { fileURL?: URL }): Promise<RenderedContent>;
  generateDigest(data: Record<string, unknown> | string): string;
  refreshContextData?: Record<string, unknown>;
};
/** An Astro-compatible, named build-time content loader. */
export type Loader<out Source = unknown> = {
  /** Type-only marker preserving metadata inference without changing Astro's load signature. */
  readonly [loaderSourceType]?: Source;
  name: string;
  schema?: unknown;
  createSchema?(): MaybePromise<{ schema: unknown; types?: string }>;
  load(context: LoaderContext<Source>): Promise<void>;
};
/** Infers the source metadata a typed loader supplies to computed resolvers. */
export type LoaderSource<Value> = Value extends { readonly [loaderSourceType]?: infer Source }
  ? Source
  : unknown;

export type LoaderEntry<Source = unknown> = {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  rendered?: RenderedContent;
  source?: string;
  sourceData?: Source;
};
export type LoaderUpdate = { upsert?: readonly LoaderEntry[]; remove?: readonly string[] };
export type LoaderCleanup = () => MaybePromise<void>;
export type LoaderWatchContext = {
  signal: AbortSignal;
  invalidate(): void;
  update(batch: LoaderUpdate): void;
  error(cause: unknown): void;
};
