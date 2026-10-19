import { createHash } from "node:crypto";
import path from "node:path";
import type { LoaderContext, LoaderConfig } from "../../loaders/types.ts";
import type { FSWatcher } from "chokidar";
import type { Schema } from "../../collection/types.ts";
import type {
  Loader,
  LoaderCleanup,
  LoaderEntry,
  LoaderWatchContext,
} from "../../loaders/types.ts";
import { isRecord, validate } from "../../preparation/validation.ts";
import { renderMarkdown } from "../../runtime/markdown.ts";
import { detach, encode } from "../../shared/values.ts";
import { valuePath } from "../../shared/values.ts";
import { contentError } from "../../shared/errors.ts";
import { loaderConfig, loaderLogger } from "./context.ts";
import { createStores, type LoaderStoreState } from "./store.ts";
import { guardedWatcher } from "./watcher.ts";

export type LoaderSessionOptions = {
  root: string;
  collection: string;
  signal: AbortSignal;
  schema?: Schema;
  watcher?: FSWatcher;
  config?: Partial<LoaderConfig>;
};
export type LoaderSession = {
  schema: Schema;
  parsed: WeakMap<object, Schema | undefined>;
  load(context: { signal: AbortSignal }): Promise<LoaderEntry[]>;
  watch(context: Omit<LoaderWatchContext, "update">): Promise<LoaderCleanup>;
};
type LoaderState = LoaderStoreState & {
  root: string;
  lifetime: AbortSignal;
  watcher?: FSWatcher;
  subscription?: Omit<LoaderWatchContext, "update">;
  changed: boolean;
  queued: boolean;
  initialized: boolean;
  failedInitialLoad: boolean;
  guards: Set<() => void>;
};

/** Narrows schema providers without coupling native ContentQuery definitions to Zod. */
function standardSchema(value: unknown): value is Schema {
  return (
    !!value &&
    typeof value === "object" &&
    "~standard" in value &&
    isRecord(value["~standard"]) &&
    typeof value["~standard"].validate === "function"
  );
}

/** Owns a collection's mutable loader store and converts completed loads into immutable sources. */
export function createLoaderSession(source: Loader, options: LoaderSessionOptions): LoaderSession {
  const parsed = new WeakMap<object, Schema | undefined>();
  const state: LoaderState = {
    root: path.resolve(options.root),
    lifetime: options.signal,
    watcher: options.watcher,
    entries: new Map(),
    metadata: new Map(),
    changed: false,
    queued: false,
    initialized: false,
    failedInitialLoad: false,
    guards: new Set(),
  };
  let declaredSchema: Promise<unknown> | undefined;
  const schema: Schema = options.schema ?? {
    "~standard": {
      version: 1,
      vendor: "content-query",
      async validate(value) {
        declaredSchema ??= Promise.resolve()
          .then(async () => {
            const authored: unknown = "schema" in source ? source.schema : undefined;
            if (authored) {
              return typeof authored === "function" ? authored() : authored;
            }
            return "createSchema" in source ? (await source.createSchema?.())?.schema : undefined;
          })
          .catch((cause) => {
            declaredSchema = undefined;
            throw cause;
          });
        const provider = await declaredSchema;
        if (!provider) {
          return { value: value as Record<string, unknown> };
        }
        if (standardSchema(provider)) {
          const result = await provider["~standard"].validate(value);
          return result.issues
            ? { issues: result.issues }
            : isRecord(result.value)
              ? { value: result.value }
              : {
                  issues: [
                    { message: "Astro loader schemas must produce a record of named fields." },
                  ],
                };
        }
        const legacy =
          provider && typeof provider === "object" && "safeParseAsync" in provider
            ? provider.safeParseAsync
            : undefined;
        const result =
          typeof legacy === "function"
            ? await (
                legacy as (
                  value: unknown,
                ) => ReturnType<(typeof import("zod/v4/core"))["safeParseAsync"]>
              ).call(provider, value)
            : await (async () => {
                const zod = await import("zod/v4/core");
                return zod.safeParseAsync(
                  provider as Parameters<typeof zod.safeParseAsync>[0],
                  value,
                );
              })();
        return result.success
          ? { value: result.data as Record<string, unknown> }
          : { issues: result.error.issues };
      },
    },
  };

  /** Converts the private store into source-independent ContentQuery entries. */
  function snapshot(state: LoaderState): LoaderEntry[] {
    return [...state.entries.values()].map((entry) => ({
      id: entry.id,
      data: entry.data,
      ...(entry.body === undefined ? {} : { body: entry.body }),
      ...(entry.rendered === undefined ? {} : { rendered: entry.rendered }),
      ...(entry.filePath === undefined ? {} : { source: path.resolve(state.root, entry.filePath) }),
    }));
  }
  /** Coalesces synchronous store batches into a complete validated publication. */
  function changed(state: LoaderState): void {
    state.changed = true;
    if (!state.queued) {
      state.queued = true;
      queueMicrotask(() => {
        state.queued = false;
        if (!state.lifetime.aborted) {
          state.subscription?.invalidate();
        }
      });
    }
  }
  return {
    schema,
    parsed,
    async load(context) {
      context.signal.throwIfAborted();
      if (state.changed) {
        state.changed = false;
        return snapshot(state);
      }
      const candidate: LoaderStoreState = {
        entries: new Map(state.entries),
        metadata: new Map(state.metadata),
      };
      let committed = false;
      let retired = false;
      let batch: LoaderStoreState | undefined;
      let batchChanged = false;
      const pending = new Set<Promise<unknown>>();
      let parseFailure: { cause: unknown } | undefined;
      const effectiveSchema = schema;
      const stores = createStores(
        () => batch ?? (committed ? state : candidate),
        parsed,
        () => {
          if (batch) {
            batchChanged = true;
          } else if (committed && !retired && !state.lifetime.aborted) {
            changed(state);
          }
        },
      );
      /** Awaits parsing work even when a source uses unawaited stream callbacks. */
      async function settled(): Promise<void> {
        while (pending.size) {
          await Promise.all(pending);
        }
        if (parseFailure) {
          const { cause } = parseFailure;
          parseFailure = undefined;
          throw cause;
        }
      }
      const guarded = state.watcher
        ? guardedWatcher(
            state.watcher,
            async (callback) => {
              if (retired || state.lifetime.aborted) {
                return;
              }
              const current = committed ? state : candidate;
              batch = { entries: new Map(current.entries), metadata: new Map(current.metadata) };
              batchChanged = false;
              parseFailure = undefined;
              try {
                await callback();
                await settled();
                state.lifetime.throwIfAborted();
                current.entries = batch.entries;
                current.metadata = batch.metadata;
                if (committed && batchChanged) {
                  changed(state);
                }
              } catch (cause) {
                await Promise.allSettled(pending);
                parseFailure = undefined;
                throw cause;
              } finally {
                batch = undefined;
              }
            },
            (cause) => {
              if (!state.lifetime.aborted) {
                state.subscription?.error(cause);
              }
            },
          )
        : undefined;
      const loaderContext: LoaderContext = {
        ...stores,
        collection: options.collection,
        config: loaderConfig(state.root, options.config),
        logger: loaderLogger(source.name),
        signal: context.signal,
        watcher: guarded?.watcher,
        generateDigest: (data) => createHash("sha256").update(encode(data)).digest("hex"),
        async renderMarkdown(body) {
          const { html, headings } = await renderMarkdown(body);
          return { html, metadata: { headings } };
        },
        parseData({ id, data, filePath }) {
          const operation = (async () => {
            state.lifetime.throwIfAborted();
            const result = await validate(effectiveSchema, data, {
              operation: "build",
              collection: options.collection,
              id,
              source: filePath === undefined ? undefined : path.resolve(state.root, filePath),
            });
            if (!isRecord(result)) {
              throw new Error("Validated Astro loader metadata must be a record of named fields.");
            }
            let copied: Record<string, unknown>;
            try {
              copied = detach(result);
            } catch (cause) {
              const formatted =
                cause &&
                typeof cause === "object" &&
                "path" in cause &&
                typeof cause.path === "string"
                  ? cause.path
                  : "";
              throw contentError(cause, {
                code: "validation-error",
                operation: "build",
                collection: options.collection,
                id,
                source: filePath === undefined ? undefined : path.resolve(state.root, filePath),
                path: formatted ? valuePath(formatted) : undefined,
                message: formatted
                  ? `${cause instanceof Error ? cause.message : "Unsupported parsed metadata."} (at ${formatted})`
                  : cause instanceof Error
                    ? cause.message
                    : "Unsupported parsed metadata.",
              });
            }
            parsed.set(copied, effectiveSchema);
            return copied as typeof data;
          })();
          pending.add(operation);
          // Keep a rejection handler even for loaders that forget to await parseData().
          void operation.then(
            () => pending.delete(operation),
            (cause) => {
              pending.delete(operation);
              parseFailure = { cause };
              if (committed && !batch && !retired) {
                state.subscription?.error(cause);
              }
            },
          );
          return operation;
        },
      };
      try {
        state.failedInitialLoad = false;
        await source.load(loaderContext);
        await settled();
        context.signal.throwIfAborted();
        state.entries = candidate.entries;
        state.metadata = candidate.metadata;
        committed = true;
        state.initialized = true;
        if (guarded) {
          state.guards.add(() => guarded.cleanup());
        }
        return snapshot(state);
      } catch (cause) {
        retired = true;
        if (!state.initialized && !context.signal.aborted) {
          state.failedInitialLoad = true;
        }
        guarded?.cleanup();
        throw cause;
      }
    },
    async watch(context) {
      state.subscription = context;
      /** Retries failed startup loads whose source code could not install its own listener yet. */
      function retryInitialLoad(): void {
        if (state.failedInitialLoad && !state.lifetime.aborted) {
          context.invalidate();
        }
      }
      state.watcher?.on("all", retryInitialLoad);
      return () => {
        state.subscription = undefined;
        state.watcher?.off("all", retryInitialLoad);
        for (const cleanup of state.guards) {
          cleanup();
        }
        state.guards.clear();
      };
    },
  };
}
