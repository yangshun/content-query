import { ContentError, invalidQuery } from "../shared/errors.ts";
import { assertServerOnly } from "../shared/server-only.ts";
import type { Relationship } from "../collection/types.ts";
import { createFrom } from "../query/from.ts";
import type { QueryRegistry } from "../query/plan.ts";
import { createQueryNamespace, relationalPlan } from "../query/relational.ts";
import { createRunner } from "./content.ts";
import { prepareRelationships } from "./relationships.ts";
import {
  queryStyleDisabledMessage,
  queryStyleMembers,
  styleOfMember,
  type QueryStyleMember,
} from "./query-style.ts";
import type { ContentState, PreparedCollection, PreparedRevision } from "./revision.ts";

assertServerOnly();

/** One loaded collection: its name and the live state whose current revision contains it. */
type CollectionSource = Readonly<{ name: string; state: ContentState }>;
/** A combined revision and the source revisions it was built from. */
type Combination = { parts: readonly PreparedRevision[]; revision: PreparedRevision };

/** The collections each handle loads: its own first, then supplied ones in name order. */
const handleSources = new WeakMap<object, readonly CollectionSource[]>();
/** Combined revisions by the primary collection's revision and the loaded collection names. */
const combinations = new WeakMap<PreparedRevision, Map<string, Combination>>();
const relationalMembers = ["findMany", "findFirst", "paginate"] as const;

/** Reads the source state's current revision, which must still contain the collection. */
function currentRevision({ name, state }: CollectionSource): PreparedRevision {
  if (state.error) {
    throw state.error;
  }
  const revision = state.revision;
  if (!revision) {
    throw new ContentError({
      code: "artifact-error",
      message: "No prepared content revision is available.",
    });
  }
  if (!Object.hasOwn(revision.collections, name) || !Object.hasOwn(revision.registry, name)) {
    invalidQuery(`Unknown collection "${name}".`);
  }
  return revision;
}

/**
 * Describes exactly the loaded collections. Relationships whose target is not loaded become
 * `unavailable`, so queries that use them report which collection to supply.
 */
function scopeRegistry(
  sources: readonly CollectionSource[],
  descriptors: readonly (QueryRegistry[string] | undefined)[],
): QueryRegistry {
  const loaded = new Set(sources.map((source) => source.name));
  const registry = Object.create(null) as QueryRegistry;
  sources.forEach((source, index) => {
    const descriptor = descriptors[index] ?? { relationships: {} };
    const relationships = Object.create(null) as Record<string, Relationship>;
    const unavailable = Object.create(null) as Record<string, string>;
    for (const [name, relation] of Object.entries(descriptor.relationships)) {
      if (loaded.has(relation.collection)) {
        relationships[name] = relation;
      } else {
        unavailable[name] = relation.collection;
      }
    }
    registry[source.name] = {
      relationships,
      ...(descriptor.payloads ? { payloads: descriptor.payloads } : {}),
      ...(Object.keys(unavailable).length ? { unavailable } : {}),
    };
  });
  return registry;
}

/** Builds one revision over exactly the loaded collections, relating only loaded relationships. */
function combine(
  sources: readonly CollectionSource[],
  parts: readonly PreparedRevision[],
): PreparedRevision {
  const registry = scopeRegistry(
    sources,
    sources.map((source, index) => parts[index]!.registry[source.name]),
  );
  const collections = Object.create(null) as Record<string, PreparedCollection>;
  sources.forEach((source, index) => {
    // Read through to the source collection, so the combination never holds stale fields.
    const prepared = parts[index]!.collections[source.name]!;
    collections[source.name] = {
      get records() {
        return prepared.records;
      },
      get builtins() {
        return prepared.builtins;
      },
      get payloads() {
        return prepared.payloads;
      },
      get sources() {
        return prepared.sources;
      },
      relationships: registry[source.name]!.relationships,
    };
  });
  // Collections from one revision keep sharing its payload caches.
  const shared = parts.every((part) => part === parts[0]);
  const revision: PreparedRevision = {
    registry,
    collections,
    relations: new Map(),
    active: 0,
    payloadCache: shared ? parts[0]!.payloadCache : new Map(),
    renderCache: shared ? parts[0]!.renderCache : new Map(),
    get renderMarkdown() {
      return parts.find((part) => part.renderMarkdown)?.renderMarkdown;
    },
    ...(parts[0]!.queryStyle ? { queryStyle: parts[0]!.queryStyle } : {}),
  };
  // Operations pinned to the combination also pin every revision it was built from.
  let active = 0;
  Object.defineProperty(revision, "active", {
    get: () => active,
    set: (value: number) => {
      for (const part of new Set(parts)) {
        part.active += value - active;
      }
      active = value;
    },
  });
  const errors = prepareRelationships(revision);
  if (errors.length) {
    throw new ContentError({
      code: "artifact-error",
      message:
        "Could not relate the supplied collections. Rebuild content so every collection comes from the same build.",
      cause: errors[0],
    });
  }
  return revision;
}

/** Returns the cached revision over the loaded collections, rebuilding it when a source changed. */
function loadedRevision(sources: readonly CollectionSource[]): PreparedRevision {
  const parts = sources.map(currentRevision);
  let cache = combinations.get(parts[0]!);
  if (!cache) {
    cache = new Map();
    combinations.set(parts[0]!, cache);
  }
  const key = JSON.stringify(sources.map((source) => source.name));
  const cached = cache.get(key);
  if (cached && cached.parts.every((part, index) => part === parts[index])) {
    return cached.revision;
  }
  const revision = combine(sources, parts);
  cache.set(key, { parts, revision });
  return revision;
}

/**
 * Reads the registry that queries build against. While a source holds an error, it falls back to
 * the declared registries, so queries still build and running them reports the error.
 */
function loadedRegistry(sources: readonly CollectionSource[]): QueryRegistry {
  if (sources.every((source) => !source.state.error && source.state.revision)) {
    return loadedRevision(sources).registry;
  }
  return scopeRegistry(
    sources,
    sources.map(({ name, state }) => {
      const registry = state.revision?.registry ?? state.registry;
      return registry && Object.hasOwn(registry, name) ? registry[name] : undefined;
    }),
  );
}

/** Orders sources canonically and rejects two different copies of one collection. */
function normalizeSources(
  primary: CollectionSource,
  supplied: readonly CollectionSource[],
): readonly CollectionSource[] {
  const byName = new Map([[primary.name, primary]]);
  for (const source of supplied) {
    const existing = byName.get(source.name);
    if (existing && existing.state !== source.state) {
      invalidQuery(`using() received two different copies of collection "${source.name}".`);
    }
    byName.set(source.name, existing ?? source);
  }
  const others = [...byName.values()]
    .filter((source) => source !== primary)
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return Object.freeze([primary, ...others]);
}

/**
 * Creates the query handle for one collection. Its queries load only that collection plus the
 * collections passed to `using()`; relationships into any other collection are unavailable.
 *
 * @param primary - The queried collection and the state that holds it.
 * @param supplied - Collections that relationships may load.
 * @returns The collection handle.
 */
export function createCollection(
  primary: CollectionSource,
  supplied: readonly CollectionSource[] = [],
): object {
  const sources = normalizeSources(primary, supplied);
  const name = primary.name;
  const state: ContentState = {
    get error() {
      return sources.map((source) => source.state.error).find(Boolean);
    },
    get revision() {
      return loadedRevision(sources);
    },
  };
  const run = createRunner(state);
  const registry = () => loadedRegistry(sources);
  const queries = createQueryNamespace(registry, run) as Record<
    string,
    Record<(typeof relationalMembers)[number], (options?: unknown) => unknown>
  >;
  /** Rejects a member that the collection's configured query style disables. */
  function allow(member: QueryStyleMember): void {
    const style = primary.state.revision?.queryStyle;
    if (style && styleOfMember(member) !== style) {
      invalidQuery(queryStyleDisabledMessage(name, member, style));
    }
  }
  const handle: Record<string, unknown> = {
    using(...collections: unknown[]) {
      const extra = collections.flatMap((collection) => {
        const found =
          collection && typeof collection === "object" ? handleSources.get(collection) : undefined;
        if (!found) {
          invalidQuery("using() accepts collections imported from their #content-query entries.");
        }
        return found;
      });
      return createCollection(primary, [...sources.slice(1), ...extra]);
    },
    count(options?: unknown) {
      if (options !== undefined) {
        allow("count(options)");
      }
      return run(relationalPlan(registry(), name, options ?? {}), "count");
    },
  };
  for (const member of relationalMembers) {
    handle[member] = (options?: unknown) => {
      allow(member);
      return queries[name]![member](options);
    };
  }
  for (const member of queryStyleMembers.fluent) {
    handle[member] = (...arguments_: unknown[]) => {
      allow(member);
      const query = createFrom(registry, run, name) as Record<
        string,
        (...values: unknown[]) => unknown
      >;
      return query[member]!(...arguments_);
    };
  }
  // Handles stay extensible, so tests can spy on a collection's methods.
  handleSources.set(handle, sources);
  return handle;
}

/**
 * Creates a live map of collection handles over one state, for sessions and tests. Handles are
 * created on first access and keep reading the state's current revision.
 *
 * @param state - Session or artifact state.
 * @returns Collection handles keyed by collection name.
 */
export function createCollections(state: ContentState): Record<string, object> {
  const handles = new Map<string, object>();
  const names = () => Object.keys(state.revision?.registry ?? state.registry ?? {});
  /** Reuses one handle per name, so `using()` can recognize it. */
  function handle(name: string): object {
    let cached = handles.get(name);
    if (!cached) {
      cached = createCollection({ name, state });
      handles.set(name, cached);
    }
    return cached;
  }
  /** Exposes current collections, and any name while an error makes queries report it. */
  function exposed(name: string | symbol): name is string {
    return (
      typeof name === "string" &&
      (names().includes(name) || (state.error !== undefined && name !== "then"))
    );
  }
  return new Proxy(Object.create(null) as Record<string, object>, {
    get(_target, name) {
      return exposed(name) ? handle(name) : undefined;
    },
    has(_target, name) {
      return exposed(name);
    },
    ownKeys() {
      return names();
    },
    getOwnPropertyDescriptor(_target, name) {
      return exposed(name)
        ? { configurable: true, enumerable: true, value: handle(name), writable: false }
        : undefined;
    },
  });
}

/**
 * Keeps one collection handle live across host-delivered development revisions.
 *
 * @param initial - The first prepared state.
 * @param name - The collection the handle queries.
 * @returns The handle and an `update()` that switches its state to a newer revision or error.
 */
export function createLiveCollection(initial: ContentState, name: string) {
  const state: ContentState = {
    revision: initial.revision,
    registry: initial.registry,
    error: initial.error,
  };
  return {
    collection: createCollection({ name, state }),
    update(next: ContentState) {
      state.revision = next.revision;
      state.registry = next.registry;
      state.error = next.error;
    },
  };
}
