import type { MaybePromise } from "../shared/types.ts";
import type { RenderedContent } from "../runtime/types.ts";

/** A stored content record, following Astro's build-time DataEntry contract. */
export type DataEntry<Data extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  data: Data;
  body?: string;
  rendered?: RenderedContent;
  filePath?: string;
  digest?: string | number;
  deferredRender?: boolean;
  assetImports?: string[];
  imageImports?: (string | number)[][];
};
export type DataStore = {
  get<Data extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
  ): DataEntry<Data> | undefined;
  set<Data extends Record<string, unknown>>(entry: DataEntry<Data>): boolean;
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
export type LoaderContext = {
  collection: string;
  store: DataStore;
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
export type Loader = {
  name: string;
  schema?: unknown;
  createSchema?(): MaybePromise<{ schema: unknown; types?: string }>;
  load(context: LoaderContext): Promise<void>;
};

export type LoaderEntry = {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  rendered?: RenderedContent;
  source?: string;
};
export type LoaderUpdate = { upsert?: readonly LoaderEntry[]; remove?: readonly string[] };
export type LoaderCleanup = () => MaybePromise<void>;
export type LoaderWatchContext = {
  signal: AbortSignal;
  invalidate(): void;
  update(batch: LoaderUpdate): void;
  error(cause: unknown): void;
};
