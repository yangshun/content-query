import path from "node:path";
import type { FSWatcher } from "chokidar";
import { ContentError, contentError, groupDiagnostics, withContext } from "../shared/errors.ts";
import { prepareRevision, type CandidateSources, type PreparationCache } from "./prepare.ts";
import { normalizeSnapshot } from "./validation.ts";
import { createRuntime, type Content } from "../runtime/content.ts";
import type { ContentState, PreparedRevision } from "../runtime/revision.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { LoaderCleanup } from "../loaders/types.ts";
import { loadRegistry } from "./config.ts";
import { watchProject, watchSources, type SourceWatchOptions } from "./watch.ts";
import { createLoaderSession, type LoaderSession } from "./loaders/session.ts";

export type ContentSession<Registry extends CollectionRegistry = {}> = {
  content: Content<Registry>;
  dispose(): Promise<void>;
};
export type SessionOptions = {
  root: string;
  config: string;
  watch: boolean;
  outDir: string;
  registry?: CollectionRegistry;
  publish?(
    revision: PreparedRevision,
    registry: CollectionRegistry,
    signal: AbortSignal,
  ): Promise<void>;
  change?(state: ContentState): void;
};
type Command =
  | { kind: "invalidate"; collection: string }
  | { kind: "error"; cause: unknown }
  | { kind: "config" };
export type SessionInternals = {
  state: ContentState;
  idle(): Promise<void>;
  invalidate(): void;
};
const internals = new WeakMap<object, SessionInternals>();

/** Gives integrations private lifecycle access without expanding the application session API. */
export function sessionInternals(session: ContentSession): SessionInternals {
  const internal = internals.get(session);
  if (!internal) {
    throw new Error("Unknown ContentQuery session.");
  }
  return internal;
}

/** Creates a preparation session with ordered source commands and atomic revision publication. */
export async function createSession<Registry extends CollectionRegistry = {}>(
  options: SessionOptions,
): Promise<ContentSession<Registry>> {
  options = {
    ...options,
    root: path.resolve(options.root),
    config: path.resolve(options.root, options.config),
    outDir: path.resolve(options.root, options.outDir),
  };
  const state: ContentState = {};
  let registry: CollectionRegistry = {};
  let loaders = new Map<string, LoaderSession>();
  let configDependencies: ReadonlySet<string> | undefined;
  let configurationError: ContentError | undefined;
  const candidates: CandidateSources = new Map();
  const cache: PreparationCache = new Map();
  let cleanups: LoaderCleanup[] = [];
  let subscriptions = new AbortController();
  let attempt: AbortController | undefined;
  let watcher: FSWatcher | undefined;
  let disposed = false;
  let initializing = true;
  let running: Promise<void> | undefined;
  let commands: Command[] = [];
  // Collections owed a fresh snapshot; kept until an attempt runs, even past a failed batch.
  const stale = new Set<string>();
  let loading = new Set<string>();
  let generation = 0;
  const loadFailures = new Map<string, ContentError>();
  const watchOptions: SourceWatchOptions = {
    root: options.root,
    config: options.config,
    output: options.publish ? options.outDir : undefined,
    registry: () => registry,
    dependencies: () => configDependencies,
    configChanged: () => enqueue({ kind: "config" }),
    invalidated: (collection) => enqueue({ kind: "invalidate", collection }),
    failed: (cause) => enqueue({ kind: "error", cause }),
  };

  /** Queues ordered notifications and makes any in-flight preparation obsolete. */
  function enqueue(command: Command): void {
    if (disposed) {
      return;
    }
    for (const name of loading) {
      if (!commands.some((queued) => queued.kind === "invalidate" && queued.collection === name)) {
        commands.push({ kind: "invalidate", collection: name });
      }
    }
    commands.push(command);
    generation++;
    attempt?.abort();
    if (!running && !initializing) {
      running = Promise.resolve()
        .then(drain)
        .finally(() => {
          running = undefined;
          if (commands.length && !disposed) {
            enqueueDrain();
          }
        });
    }
  }
  /** Restarts draining without inventing another source notification. */
  function enqueueDrain(): void {
    if (!running && !disposed) {
      running = Promise.resolve()
        .then(drain)
        .finally(() => {
          running = undefined;
          if (commands.length && !disposed) {
            enqueueDrain();
          }
        });
    }
  }
  /** Reports current preparation failures while keeping recovery subscriptions alive. */
  function fail(cause: unknown): void {
    state.error = contentError(cause, {
      code: "source-error",
      operation: "prepare",
      message: cause instanceof Error ? cause.message : "Content preparation failed.",
    });
    options.change?.(state);
  }
  /** Aborts an owned subscription group and attempts every cleanup even when one fails. */
  async function releaseResources(
    controller: AbortController,
    handlers: LoaderCleanup[],
  ): Promise<void> {
    controller.abort();
    const outcomes = await Promise.allSettled(handlers.map(async (cleanup) => cleanup()));
    const failure = outcomes.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      throw failure.reason;
    }
  }
  /** Releases the active configuration independently from load-attempt cancellation. */
  async function releaseSubscriptions(): Promise<void> {
    const previous = cleanups;
    cleanups = [];
    await releaseResources(subscriptions, previous);
  }
  /** Stages all replacement subscriptions before adopting a valid configuration. */
  async function configure(initial: boolean): Promise<void> {
    // Unknown until this load succeeds, so watching stays conservative while config is broken.
    configDependencies = undefined;
    // A configuration that fails to load never takes over; earlier subscriptions keep recovery alive.
    const loaded = options.registry
      ? { registry: options.registry, dependencies: new Set<string>(), loaderConfig: undefined }
      : await loadRegistry(options.config);
    const nextSubscriptions = new AbortController();
    const nextCleanups: LoaderCleanup[] = [];
    const nextLoaders = new Map<string, LoaderSession>();
    const nextRegistry: CollectionRegistry = Object.create(null) as CollectionRegistry;
    const notifications: Command[] = [];
    let installed = false;
    /** Retains setup notifications and ignores callbacks from aborted configurations. */
    function receive(command: Command): void {
      if (nextSubscriptions.signal.aborted) {
        return;
      }
      if (installed) {
        enqueue(command);
      } else {
        notifications.push(command);
      }
    }
    try {
      for (const [name, definition] of Object.entries(loaded.registry)) {
        const loader = createLoaderSession(definition.loader, {
          root: options.root,
          config: loaded.loaderConfig,
          collection: name,
          schema: definition.schema,
          signal: nextSubscriptions.signal,
          watcher,
        });
        nextLoaders.set(name, loader);
        nextRegistry[name] = { ...definition, schema: loader.schema };
        if (options.watch) {
          const cleanup = await loader.watch({
            signal: nextSubscriptions.signal,
            invalidate: () => receive({ kind: "invalidate", collection: name }),
            error: (cause) => receive({ kind: "error", cause }),
          });
          if (typeof cleanup !== "function") {
            throw new Error(`Loader watch() for "${name}" must return a cleanup function.`);
          }
          nextCleanups.push(cleanup);
        }
      }
      if (watcher) {
        await watchSources(
          {
            ...watchOptions,
            registry: () => loaded.registry,
            dependencies: () => loaded.dependencies,
            configChanged: () => receive({ kind: "config" }),
            invalidated: (collection) => receive({ kind: "invalidate", collection }),
            failed: (cause) => receive({ kind: "error", cause }),
          },
          (cleanup) => nextCleanups.push(cleanup),
        );
      }
      if (disposed) {
        throw new Error("Content session was disposed during configuration setup.");
      }
      if (!initial) {
        await releaseSubscriptions();
      }
    } catch (cause) {
      const failure = contentError(cause, {
        code: "source-error",
        operation: "prepare",
        source: options.config,
        message: cause instanceof Error ? cause.message : "Configuration setup failed.",
      });
      try {
        await releaseResources(nextSubscriptions, nextCleanups);
      } catch (cleanup) {
        throw groupDiagnostics([
          ...failure.diagnostics,
          ...contentError(cleanup, {
            code: "source-error",
            operation: "dispose",
            message: "Subscription cleanup failed.",
          }).diagnostics,
        ]);
      }
      throw failure;
    }
    subscriptions = nextSubscriptions;
    cleanups = nextCleanups;
    registry = nextRegistry;
    loaders = nextLoaders;
    configDependencies = loaded.dependencies;
    state.registry = Object.fromEntries(
      Object.entries(registry).map(([name, definition]) => [
        name,
        { relationships: definition.relationships ?? {} },
      ]),
    );
    candidates.clear();
    cache.clear();
    loadFailures.clear();
    configurationError = undefined;
    installed = true;
    for (const notification of notifications) {
      enqueue(notification);
    }
  }
  /** Acquires invalidated snapshots and publishes only the complete current attempt. */
  async function prepare(names: Set<string>): Promise<void> {
    const currentGeneration = generation;
    attempt = new AbortController();
    const signal = attempt.signal;
    loading = names;
    const acquired = await Promise.allSettled(
      [...names].map(async (name) => {
        const entries = await loaders.get(name)!.load({ signal });
        return [name, normalizeSnapshot(entries, name)] as const;
      }),
    );
    if (disposed || currentGeneration !== generation) {
      return;
    }
    loading = new Set();
    acquired.forEach((result, index) => {
      const name = [...names][index]!;
      if (result.status === "fulfilled") {
        candidates.set(...result.value);
        loadFailures.delete(name);
      } else {
        loadFailures.set(
          name,
          withContext(result.reason, {
            code: "source-error",
            operation: "prepare",
            collection: name,
            message: `Could not load collection "${name}"`,
          }),
        );
      }
    });
    try {
      const failures = [...loadFailures.values()];
      const revision = await prepareRevision(
        registry,
        candidates,
        cache,
        signal,
        options.watch,
        failures.flatMap((error) => error.diagnostics),
        new Map([...loaders].map(([name, loader]) => [name, loader.parsed])),
      );
      if (disposed || currentGeneration !== generation) {
        return;
      }
      await options.publish?.(revision, registry, signal);
      if (disposed || currentGeneration !== generation) {
        return;
      }
      state.revision = revision;
      state.error = undefined;
      options.change?.(state);
    } catch (cause) {
      if (!disposed && currentGeneration === generation) {
        fail(cause);
      }
    }
  }
  /** Lets a newer attempt progress even when obsolete user code ignores its signal. */
  async function runAttempt(names: Set<string>): Promise<void> {
    const work = prepare(names);
    const signal = attempt!.signal;
    if (signal.aborted) {
      return;
    }
    let finish: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      finish = () => resolve();
      signal.addEventListener("abort", finish, { once: true });
    });
    try {
      await Promise.race([work, aborted]);
    } finally {
      if (finish) {
        signal.removeEventListener("abort", finish);
      }
    }
  }
  /** Applies queued source state separately from publishing validated content. */
  async function drain(): Promise<void> {
    while (commands.length && !disposed) {
      const pending = commands;
      commands = [];
      let failedCommand = false;
      for (const command of pending) {
        try {
          if (command.kind === "error") {
            throw command.cause;
          }
          if (command.kind === "config") {
            await configure(false);
            for (const name of Object.keys(registry)) {
              stale.add(name);
            }
          } else if (command.kind === "invalidate") {
            stale.add(command.collection);
          }
        } catch (cause) {
          if (command.kind === "config") {
            configurationError = contentError(cause, {
              code: "source-error",
              operation: "prepare",
              source: options.config,
              message: cause instanceof Error ? cause.message : "Configuration reload failed.",
            });
          }
          fail(configurationError ?? cause);
          failedCommand = true;
        }
      }
      // A failed command surfaces its error; owed snapshots wait for the next accepted command.
      if (!failedCommand && !configurationError) {
        const names = new Set([...stale].filter((name) => Object.hasOwn(registry, name)));
        stale.clear();
        await runAttempt(names);
      }
    }
  }
  /** Idempotently stops watchers and prevents obsolete attempts from publishing. */
  async function dispose(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;
    generation++;
    attempt?.abort();
    const results = await Promise.allSettled([
      watcher?.close() ?? Promise.resolve(),
      releaseSubscriptions(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw contentError(failed.reason, {
        code: "source-error",
        operation: "dispose",
        message: "A content subscription could not be cleaned up.",
      });
    }
  }
  const session: ContentSession<Registry> = { content: createRuntime<Registry>(state), dispose };
  internals.set(session, {
    state,
    async idle() {
      await Promise.resolve();
      while (running) {
        await running;
      }
    },
    invalidate() {
      enqueue({ kind: "config" });
    },
  });
  try {
    if (options.watch) {
      await watchProject(watchOptions, (created) => {
        watcher = created;
      });
    }
    await configure(true);
    await runAttempt(new Set(Object.keys(registry)));
    initializing = false;
    if (commands.length) {
      enqueueDrain();
      while (running) {
        await running;
      }
    }
    if (state.error && !options.watch) {
      throw state.error;
    }
    return session;
  } catch (cause) {
    const failure = contentError(cause, {
      code: "source-error",
      operation: "prepare",
      message: "Content configuration or subscription initialization failed.",
    });
    try {
      await dispose();
    } catch (cleanup) {
      throw new ContentError({
        ...failure.diagnostics[0]!,
        message: failure.message,
        diagnostics: [
          ...failure.diagnostics,
          ...contentError(cleanup, {
            code: "source-error",
            operation: "dispose",
            message: "Subscription cleanup failed.",
          }).diagnostics,
        ],
      });
    }
    throw failure;
  }
}
