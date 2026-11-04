import path from "node:path";
import type { GlobOptions } from "../loaders/descriptor.ts";
import { affectsSnapshot } from "../loaders/match.ts";
import { withinDirectory } from "../shared/paths.ts";
import type { Dependency } from "./files.ts";
import type { PreparationCache } from "./prepare.ts";

/**
 * A cached node that read files: an entry, whose computed fields read them, or one payload
 * variant of an entry. `key` is the entry's preparation cache key.
 */
export type DependentNode = { key: string; payload?: string; variant?: string };

/** Maps read files and globs back to the nodes that read them. */
export type DependencyIndex = {
  files: Map<string, DependentNode[]>;
  globs: { base: string; options: GlobOptions; node: DependentNode }[];
};

/**
 * Indexes every file and glob that cached entries and payload variants read.
 *
 * @param cache - The preparation cache, whose nodes record their dependencies.
 * @returns A reverse index from files and globs to nodes.
 */
export function dependencyIndex(cache: PreparationCache): DependencyIndex {
  const index: DependencyIndex = { files: new Map(), globs: [] };
  /** Records one node's dependencies. */
  function add(node: DependentNode, dependencies: readonly Dependency[]) {
    for (const dependency of dependencies) {
      if (dependency.kind === "file") {
        const nodes = index.files.get(dependency.path);
        if (nodes) {
          nodes.push(node);
        } else {
          index.files.set(dependency.path, [node]);
        }
      } else {
        index.globs.push({ base: dependency.base, options: dependency.options, node });
      }
    }
  }
  for (const [key, entry] of cache) {
    add({ key }, entry.dependencies);
    for (const [payload, cached] of entry.payloads ?? []) {
      for (const [variant, node] of cached.nodes) {
        add({ key, payload, variant }, node.dependencies);
      }
    }
  }
  return index;
}

/**
 * Finds the nodes a file event affects: nodes that read the file, nodes whose glob gains or loses
 * a match, nodes whose glob base gains a directory, and, for a removed directory, nodes that read
 * anything inside it.
 *
 * @param index - The dependency index.
 * @param event - The watcher event, such as `add`, `change`, `unlink`, or `unlinkDir`.
 * @param filename - The affected path.
 * @returns Distinct affected nodes.
 */
export function dependents(
  index: DependencyIndex,
  event: string,
  filename: string,
): DependentNode[] {
  const resolved = path.resolve(filename);
  const found = new Map<string, DependentNode>();
  /** Adds a node once. */
  const include = (node: DependentNode) =>
    found.set(JSON.stringify([node.key, node.payload, node.variant]), node);
  for (const node of index.files.get(resolved) ?? []) {
    include(node);
  }
  if (event === "unlinkDir") {
    for (const [file, nodes] of index.files) {
      if (withinDirectory(resolved, file)) {
        nodes.forEach(include);
      }
    }
  }
  for (const glob of index.globs) {
    if (
      event === "addDir"
        ? // Files written right after their directory can go unreported; re-read the glob instead.
          resolved !== glob.base && withinDirectory(glob.base, resolved)
        : affectsSnapshot({ kind: "glob", options: glob.options }, glob.base, event, resolved)
    ) {
      include(glob.node);
    }
  }
  return [...found.values()];
}

/**
 * Drops affected nodes from the cache, so the next preparation resolves them again. An entry node
 * drops the entry's whole cache record; a payload node drops only that variant.
 *
 * @param cache - The preparation cache.
 * @param nodes - The nodes to invalidate.
 */
export function invalidateNodes(cache: PreparationCache, nodes: readonly DependentNode[]): void {
  for (const node of nodes) {
    if (node.payload === undefined) {
      cache.delete(node.key);
    } else {
      cache.get(node.key)?.payloads?.get(node.payload)?.nodes.delete(node.variant!);
    }
  }
}

/**
 * Lists the paths that dependencies need watched: each read file and each glob base.
 *
 * @param index - The dependency index.
 * @returns Distinct absolute paths.
 */
export function dependencyPaths(index: DependencyIndex): string[] {
  return [...new Set([...index.files.keys(), ...index.globs.map((glob) => glob.base)])];
}
