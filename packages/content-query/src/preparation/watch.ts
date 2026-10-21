import path from "node:path";
import { realpathSync, watchFile, unwatchFile, type Stats } from "node:fs";
import { access } from "node:fs/promises";
import { watch, type FSWatcher } from "chokidar";
import { builtinLoader, builtinPath } from "../loaders/descriptor.ts";
import { affectsSnapshot } from "../loaders/match.ts";
import { withinDirectory } from "../shared/paths.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { LoaderCleanup } from "../loaders/types.ts";

// Settled writes bypass Chokidar's change-event throttle, which can drop a rapid correction.
const awaitWriteFinish = { stabilityThreshold: 50, pollInterval: 10 };

export type SourceWatchOptions = {
  root: string;
  config: string;
  output?: string;
  /** The session-owned project subscription, already ready before source setup begins. */
  projectWatcher?: FSWatcher;
  registry(): CollectionRegistry;
  /** Evaluated config modules, or undefined while the module graph is unknown. */
  dependencies(): ReadonlySet<string> | undefined;
  configChanged(): void;
  invalidated(collection: string): void;
  failed(cause: unknown): void;
};

/** Finds an existing ancestor so watching also detects a missing base directory's creation. */
async function watchAncestor(filename: string): Promise<string> {
  let ancestor = filename;
  while (true) {
    try {
      await access(ancestor);
      return ancestor;
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        return parent;
      }
      ancestor = parent;
    }
  }
}

/** Resolves symlinked ancestors so watcher paths compare with Jiti's physical module paths. */
function physicalPath(filename: string): string {
  try {
    return realpathSync(filename);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(filename)), path.basename(filename));
    } catch {
      return filename;
    }
  }
}

/** Matches edits a config reload can observe, conservatively while the module graph is unknown. */
function configDependency(options: SourceWatchOptions, filename: string): boolean {
  const resolved = path.resolve(filename);
  if (resolved === options.config) {
    return true;
  }
  const dependencies = options.dependencies();
  if (!dependencies) {
    return /\.(?:[cm]?[jt]sx?)$/.test(resolved);
  }
  return dependencies.has(resolved) || dependencies.has(physicalPath(resolved));
}

/** Resolves once a watcher has subscribed to its initial paths. */
function ready(watcher: FSWatcher): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    watcher.once("ready", resolve);
    watcher.once("error", reject);
  });
}

/** Shares the project ignore policy with declared-input subscription coverage checks. */
function projectIgnored(options: SourceWatchOptions): (filename: string) => boolean {
  const ignoredRoots = [
    ...(options.output ? [options.output] : []),
    path.join(options.root, ".content-query"),
  ];
  return (filename) =>
    filename
      .split(path.sep)
      .some((segment) =>
        ["node_modules", ".git", ".next", ".void", ".wrangler", "dist", "coverage"].includes(
          segment,
        ),
      ) || ignoredRoots.some((ignored) => withinDirectory(ignored, filename));
}

/** Registers ownership before awaiting readiness so initialization failures retain cleanup. */
export async function watchProject(
  options: SourceWatchOptions,
  register: (watcher: FSWatcher) => void,
): Promise<void> {
  const watcher = watch([options.root, await watchAncestor(path.dirname(options.config))], {
    ignoreInitial: true,
    awaitWriteFinish,
    ignored: projectIgnored(options),
  });
  register(watcher);
  watcher.on("all", (event, filename) => {
    // File-add notifications arrive after the new directory's children are subscribed.
    if (event === "addDir") {
      return;
    }
    // Application modules outside the config's evaluated graph do not affect prepared content.
    if (configDependency(options, filename)) {
      options.configChanged();
      return;
    }
  });
  watcher.on("error", (cause) => options.failed(cause));
  await ready(watcher);
}

/** Owns scoped source listeners and external subscriptions for one configuration. */
export async function watchSources(
  options: SourceWatchOptions,
  register: (cleanup: LoaderCleanup) => void,
): Promise<void> {
  const ignoredByProject = projectIgnored(options);
  // The project watcher already covers the root and the config's directory.
  const modules = [...(options.dependencies() ?? [])].filter(
    (filename) =>
      !withinDirectory(options.root, filename) &&
      !withinDirectory(path.dirname(options.config), filename) &&
      !filename.split(path.sep).includes("node_modules"),
  );
  if (modules.length) {
    const external = watch(modules, { ignoreInitial: true, awaitWriteFinish });
    register(() => external.close());
    external.on("all", () => options.configChanged());
    external.on("error", (cause) => options.failed(cause));
    await ready(external);
  }
  for (const [name, definition] of Object.entries(options.registry())) {
    const builtin = builtinLoader(definition.loader);
    if (builtin) {
      const target = builtinPath(builtin, options.root);
      // Declared inputs take precedence over project ignores such as dist/ and coverage/.
      const outputRoots = [
        path.join(options.root, ".content-query"),
        ...(options.output ? [options.output] : []),
      ];
      const ancestor = await watchAncestor(target);
      const shared =
        !ignoredByProject(target) &&
        (withinDirectory(options.root, target) ||
          withinDirectory(path.dirname(options.config), target))
          ? options.projectWatcher
          : undefined;
      // A recursive glob can include ignored descendants such as content/dist/. Keep a
      // directory subscription there, skipping ordinary files already covered by the project.
      const dedicated = !shared || builtin.kind === "glob";
      const external = dedicated
        ? watch(ancestor, {
            ignoreInitial: true,
            awaitWriteFinish,
            ignored: (filename, stats) =>
              !(withinDirectory(target, filename) || withinDirectory(filename, target)) ||
              outputRoots.some((output) => withinDirectory(output, filename)) ||
              !!(shared && stats?.isFile() && !ignoredByProject(filename)),
          })
        : shared!;
      /** Invalidates only the collection whose declared input can match this event. */
      function changed(event: string, filename: string): void {
        if (affectsSnapshot(builtin!, target, event, filename)) {
          options.invalidated(name);
        }
      }
      if (shared) {
        shared.on("all", changed);
        register(() => {
          shared.off("all", changed);
        });
      }
      if (dedicated) {
        register(() => external.close());
      }
      if (ancestor !== target && !outputRoots.some((output) => withinDirectory(output, target))) {
        /** Recovers a missing declared path even if the ancestor's creation event is lost. */
        function recheck(current: Stats, previous: Stats): void {
          if (current.nlink === 0 && previous.nlink === 0) {
            return;
          }
          external.add(target);
          if (shared && shared !== external) {
            shared.add(target);
          }
          options.invalidated(name);
        }
        // Poll only the declared file or base directory, never every file in a glob collection.
        watchFile(target, { interval: 100, persistent: false }, recheck);
        register(() => unwatchFile(target, recheck));
      }
      if (dedicated) {
        external.on("all", changed);
        external.on("error", (cause) => options.failed(cause));
        await ready(external);
      }
    }
  }
}
