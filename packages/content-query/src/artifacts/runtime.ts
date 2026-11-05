import { ContentError } from "../shared/errors.ts";
import { decode } from "../shared/values.ts";
import { createCollection, createCollections } from "../runtime/collection.ts";
import type { Collection, CollectionHandles } from "../runtime/collection-types.ts";
import type { QueryStyle } from "../runtime/query-style.ts";
import type {
  BuiltinPayload,
  PreparedCollection,
  PreparedRevision,
  QueryRecord,
} from "../runtime/revision.ts";
import type { CollectionRegistry } from "../collection/types.ts";
import type { ContentRenderResult } from "../runtime/types.ts";
import { isQueryStyle } from "../runtime/query-style.ts";
import {
  ARTIFACT_VERSION,
  CODEC_VERSION,
  type ArtifactManifest,
  type EncodedCollection,
} from "./types.ts";

/** Checks that a value is a plain record before reading generated payload tables from it. */
function isTable(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Restores lazy custom payload loaders from a generated payload table.
 *
 * @param collection - The collection name, for error messages.
 * @param payloads - Encoded loaders by payload name, entry ID, and canonical variant key.
 * @returns Decoding loaders with the same keys.
 */
function customPayloadTable(
  collection: string,
  payloads: NonNullable<EncodedCollection["payloads"]>,
): NonNullable<PreparedCollection["payloads"]> {
  if (!isTable(payloads)) {
    throw new Error(`Invalid payload table for collection "${collection}".`);
  }
  return new Map(
    Object.entries(payloads).map(([payload, entries]) => {
      if (!isTable(entries)) {
        throw new Error(`Invalid payload table for collection "${collection}".`);
      }
      return [
        payload,
        new Map(
          Object.entries(entries).map(([id, variants]) => {
            if (
              !isTable(variants) ||
              Object.values(variants).some((load) => typeof load !== "function")
            ) {
              throw new Error(`Invalid payload table for collection "${collection}".`);
            }
            return [
              id,
              new Map(
                Object.entries(variants as Record<string, () => Promise<{ default: string }>>).map(
                  ([variant, load]) => [variant, async () => decode((await load()).default)],
                ),
              ),
            ];
          }),
        ),
      ];
    }),
  );
}

/**
 * Decoded collections by generated collection module. The main server entry and collection
 * entries import the same module, so a process that loads several entries decodes it once.
 * Prepared records are never mutated, since queries project copies.
 */
const decodedCollections = new WeakMap<
  EncodedCollection,
  Omit<PreparedCollection, "relationships">
>();

/** Decodes and checks one generated collection module, reusing an earlier decoding of it. */
function decodeCollection(
  name: string,
  encoded: EncodedCollection,
): Omit<PreparedCollection, "relationships"> {
  const cached = decodedCollections.get(encoded);
  if (cached) {
    return cached;
  }
  const records = encoded.records.map((record) => decode<QueryRecord>(record));
  if (
    records.some(
      (record) =>
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        !Object.hasOwn(record, "id") ||
        typeof record.id !== "string" ||
        !record.id ||
        Object.hasOwn(record, "_adjacent") ||
        Object.hasOwn(record, "_payloads"),
    ) ||
    new Set(records.map((record) => record.id)).size !== records.length
  ) {
    throw new Error(`Invalid query records for collection "${name}".`);
  }
  const decoded = {
    records,
    builtins: new Map(
      Object.entries(encoded.builtins ?? {}).map(([id, load]) => [
        id,
        async () => decode<BuiltinPayload>((await load()).default),
      ]),
    ),
    ...(encoded.payloads ? { payloads: customPayloadTable(name, encoded.payloads) } : {}),
  };
  decodedCollections.set(encoded, decoded);
  return decoded;
}

/**
 * Initializes generated/embedded prepared content. This versioned wiring is internal.
 * Relationships are related when a query scope combines the collections it loads.
 *
 * @param manifest - The entry's manifest; its registry lists exactly the collections it serves.
 * @param collections - Generated collection modules by name.
 * @param renderMarkdown - The packaged renderer, when a served collection captured Markdown.
 * @returns The prepared revision.
 */
export function createArtifactRevision(
  manifest: ArtifactManifest,
  collections: Record<string, EncodedCollection>,
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>,
) {
  try {
    if (manifest.version !== ARTIFACT_VERSION || manifest.codec !== CODEC_VERSION) {
      throw new Error("Incompatible content artifact or codec version; regenerate content.");
    }
    if (manifest.queryStyle !== undefined && !isQueryStyle(manifest.queryStyle)) {
      throw new Error("Invalid query style in content artifact; regenerate content.");
    }
    const revision: PreparedRevision = {
      registry: manifest.collections,
      collections: Object.create(null) as PreparedRevision["collections"],
      relations: new Map(),
      active: 0,
      payloadCache: new Map(),
      renderCache: new Map(),
      renderMarkdown,
      ...(manifest.queryStyle ? { queryStyle: manifest.queryStyle } : {}),
    };
    for (const [name, descriptor] of Object.entries(manifest.collections)) {
      const encoded = collections[name];
      if (!encoded || typeof encoded !== "object" || !Array.isArray(encoded.records)) {
        throw new Error(`Missing collection artifact "${name}".`);
      }
      revision.collections[name] = {
        ...decodeCollection(name, encoded),
        relationships: descriptor.relationships,
      };
    }
    return revision;
  } catch (cause) {
    throw new ContentError({
      code: "artifact-error",
      message: "Could not initialize prepared content.",
      cause,
    });
  }
}

/**
 * Initializes one generated collection entry's export.
 *
 * @param manifest - The entry's manifest, which lists only this collection.
 * @param name - The collection's name.
 * @param collection - The generated collection module.
 * @param renderMarkdown - The packaged renderer, when the collection captured Markdown.
 * @returns The collection handle the entry exports.
 */
export function createArtifactCollection<
  Registry extends CollectionRegistry,
  Name extends keyof Registry & string,
  Style extends QueryStyle = QueryStyle,
>(
  manifest: ArtifactManifest,
  name: Name,
  collection: EncodedCollection,
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>,
): Collection<Registry, Name, Style> {
  const revision = createArtifactRevision(manifest, { [name]: collection }, renderMarkdown);
  if (!Object.hasOwn(revision.collections, name)) {
    throw new ContentError({
      code: "artifact-error",
      message: `Missing collection artifact "${name}".`,
    });
  }
  return createCollection({ name, state: { revision } }) as Collection<Registry, Name, Style>;
}

/**
 * Initializes handles for every collection of one artifact revision, sharing its caches. Tests
 * and integrations use it; applications import each collection's own entry instead.
 *
 * @param manifest - A manifest that lists every collection in `collections`.
 * @param collections - Generated collection modules by name.
 * @param renderMarkdown - The packaged renderer, when a collection captured Markdown.
 * @returns Collection handles keyed by collection name.
 */
export function createArtifactCollections<
  Registry extends CollectionRegistry,
  Style extends QueryStyle = QueryStyle,
>(
  manifest: ArtifactManifest,
  collections: Record<string, EncodedCollection>,
  renderMarkdown?: (body: string) => Promise<ContentRenderResult>,
): CollectionHandles<Registry, Style> {
  return createCollections({
    revision: createArtifactRevision(manifest, collections, renderMarkdown),
  }) as CollectionHandles<Registry, Style>;
}
