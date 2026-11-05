import type { CollectionRegistry } from "../../src/collection/types.ts";
import { createArtifactCollections } from "../../src/internal.ts";
import type { Collection, CollectionHandles } from "../../src/runtime/collection-types.ts";
import type { QueryStyle } from "../../src/runtime/query-style.ts";

/** Collection handles that each load every collection, so any relationship is available. */
export type AllCollections<
  Registry extends CollectionRegistry,
  Style extends QueryStyle = QueryStyle,
> = {
  readonly [Name in keyof Registry & string]: Collection<
    Registry,
    Name,
    Style,
    keyof Registry & string
  >;
};

/**
 * Supplies every collection to each handle, so tests written against relationships can query
 * any collection. Handles stay live: each access reads the current collections.
 *
 * @param collections - Session or artifact handles keyed by collection name.
 * @returns Handles that load every collection.
 */
export function loadAll<Registry extends CollectionRegistry, Style extends QueryStyle = QueryStyle>(
  collections: CollectionHandles<Registry, Style>,
): AllCollections<Registry, Style> {
  const handles = collections as unknown as Record<string, { using(...all: unknown[]): unknown }>;
  return new Proxy(Object.create(null) as AllCollections<Registry, Style>, {
    get(_target, name) {
      const handle = typeof name === "string" ? handles[name] : undefined;
      return handle?.using(...Object.values(handles));
    },
    ownKeys() {
      return Object.keys(handles);
    },
    getOwnPropertyDescriptor(_target, name) {
      const handle = typeof name === "string" ? handles[name] : undefined;
      return handle
        ? { configurable: true, enumerable: true, value: handle.using(...Object.values(handles)) }
        : undefined;
    },
  });
}

/**
 * Initializes every collection of an artifact revision, each loading all the others.
 *
 * @param arguments_ - The manifest, collection modules, and optional renderer.
 * @returns Handles that load every collection.
 */
export function loadArtifact<
  Registry extends CollectionRegistry,
  Style extends QueryStyle = QueryStyle,
>(...arguments_: Parameters<typeof createArtifactCollections>): AllCollections<Registry, Style> {
  return loadAll(createArtifactCollections<Registry, Style>(...arguments_));
}
