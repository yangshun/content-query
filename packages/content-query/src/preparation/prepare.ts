import {
  ContentError,
  contentError,
  groupDiagnostics,
  type ContentDiagnostic,
} from "../shared/errors.ts";
import { builtinLoader } from "../loaders/descriptor.ts";
import { renderMarkdown } from "../runtime/markdown.ts";
import { isRelationship, prepareRelationships } from "../runtime/relationships.ts";
import { detach, encode, valuePath } from "../shared/values.ts";
import type {
  ItemPayload,
  PreparedCollection,
  PreparedRevision,
  QueryRecord,
} from "../runtime/revision.ts";
import type { CollectionDefinition, CollectionRegistry } from "../collection/types.ts";
import type { LoaderEntry } from "../loaders/types.ts";

export type CandidateSources = Map<string, Map<string, LoaderEntry>>;
type PreparedEntry = {
  signature?: string;
  definition: CollectionDefinition;
  record: QueryRecord;
  payload: ItemPayload;
};
export type PreparationCache = Map<string, PreparedEntry>;

import { isRecord, validate, renderedPayload } from "./validation.ts";

/** Prepares one immutable revision, aggregating independent entry/field failures. */
export async function prepareRevision(
  registry: CollectionRegistry,
  sources: CandidateSources,
  cache: PreparationCache,
  signal: AbortSignal,
  development: boolean,
  sourceDiagnostics: readonly ContentDiagnostic[] = [],
  parsedData?: ReadonlyMap<
    string,
    WeakMap<object, import("../collection/types.ts").Schema | undefined>
  >,
): Promise<PreparedRevision> {
  const diagnostics: ContentDiagnostic[] = [...sourceDiagnostics];
  const collections: Record<string, PreparedCollection> = Object.create(null) as Record<
    string,
    PreparedCollection
  >;
  for (const [collectionName, definition] of Object.entries(registry)) {
    const records: QueryRecord[] = [];
    const payloads = new Map<string, () => Promise<ItemPayload>>();
    const computed = definition.computed ?? {};
    const relationships = definition.relationships ?? {};
    const declarationNames = [...Object.keys(computed), ...Object.keys(relationships)];
    if (
      declarationNames.some((name) => name === "id" || name === "_adjacent") ||
      new Set(declarationNames).size !== declarationNames.length ||
      Object.values(relationships).some((relation) => !isRelationship(relation))
    ) {
      diagnostics.push({
        code: "validation-error",
        operation: "prepare",
        collection: collectionName,
        message: "Invalid or overlapping computed/relationship declarations.",
      });
      continue;
    }
    const descriptor = builtinLoader(definition.loader);
    for (const entry of sources.get(collectionName)?.values() ?? []) {
      signal.throwIfAborted();
      const context = {
        operation: "prepare",
        collection: collectionName,
        id: entry.id,
        source: entry.source,
      };
      const key = JSON.stringify([collectionName, entry.id]);
      let signature: string | undefined;
      try {
        signature = encode(entry);
      } catch {
        /* Unvalidated input may contain values a schema intentionally removes. */
      }
      const previous = cache.get(key);
      if (
        signature !== undefined &&
        previous?.signature === signature &&
        previous.definition === definition
      ) {
        records.push(previous.record);
        if (Object.keys(previous.payload).length) {
          payloads.set(entry.id, async () => previous.payload);
        }
        continue;
      }
      try {
        const parsed = parsedData?.get(collectionName);
        const validated =
          parsed?.has(entry.data) && parsed.get(entry.data) === definition.schema
            ? entry.data
            : await validate(definition.schema, entry.data, context);
        signal.throwIfAborted();
        if (!isRecord(validated)) {
          throw new Error("Validated metadata must be a record of named fields.");
        }
        if (
          Object.hasOwn(validated, "id") ||
          Object.hasOwn(validated, "_adjacent") ||
          declarationNames.some((name) => Object.hasOwn(validated, name))
        ) {
          throw new Error(
            "Metadata, computed fields, relationships, and reserved id/_adjacent must have distinct names.",
          );
        }
        // Clone as one graph, before exposing data to user resolvers or retaining it.
        const metadata = detach(validated);
        const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        const before = diagnostics.length;
        for (const [field, computedField] of Object.entries(computed)) {
          try {
            const result = await computedField.resolve({
              id: entry.id,
              data: detach(metadata) as never,
              readBody: async () => entry.body,
              signal,
            });
            values[field] = await validate(computedField.schema, result, {
              ...context,
              path: [field],
            });
          } catch (cause) {
            diagnostics.push(
              ...contentError(cause, {
                ...context,
                path: [field],
                code: "validation-error",
                message: `Computed field "${field}" failed.`,
              }).diagnostics,
            );
          }
        }
        signal.throwIfAborted();
        if (before !== diagnostics.length) {
          continue;
        }
        const record = detach({ ...metadata, ...values, id: entry.id });
        const payload: ItemPayload = {};
        const markdown = descriptor?.kind === "glob" && entry.source?.toLowerCase().endsWith(".md");
        if (
          entry.body !== undefined &&
          (!markdown || descriptor?.kind !== "glob" || descriptor.options.retainBody !== false)
        ) {
          payload.body = entry.body;
        }
        const supplied = renderedPayload(entry);
        if (supplied) {
          payload.rendered = supplied;
        } else if (markdown && entry.body !== undefined) {
          if (development || descriptor.options.deferRender === true) {
            payload.markdown = entry.body;
          } else {
            try {
              payload.rendered = await renderMarkdown(entry.body);
            } catch (cause) {
              throw new ContentError({
                ...context,
                code: "render-error",
                message: "Eager Markdown compilation failed.",
                cause,
              });
            }
          }
        }
        encode(payload);
        cache.set(key, { definition, signature, record, payload });
        records.push(record);
        if (Object.keys(payload).length) {
          payloads.set(entry.id, async () => payload);
        }
      } catch (cause) {
        // Unsupported stored values report devalue's formatted location within the record.
        const formatted =
          cause && typeof cause === "object" && "path" in cause && typeof cause.path === "string"
            ? cause.path
            : "";
        const message = cause instanceof Error ? cause.message : "Entry preparation failed.";
        diagnostics.push(
          ...contentError(cause, {
            ...context,
            path: formatted ? valuePath(formatted) : undefined,
            code: "validation-error",
            message: formatted ? `${message} (at ${formatted})` : message,
          }).diagnostics,
        );
      }
    }
    collections[collectionName] = {
      records,
      relationships,
      payloads,
      sources: new Map(
        [...(sources.get(collectionName)?.values() ?? [])].map((entry) => [entry.id, entry.source]),
      ),
    };
  }
  signal.throwIfAborted();
  const revision: PreparedRevision = {
    collections,
    registry: Object.fromEntries(
      Object.entries(collections).map(([name, collection]) => [
        name,
        { relationships: collection.relationships },
      ]),
    ),
    relations: new Map(),
    active: 0,
    payloadCache: new Map(),
    renderCache: new Map(),
    renderMarkdown,
  };
  // A failed collection lacks entries, so references into or out of it would be speculative.
  const failed = diagnostics.map((diagnostic) => diagnostic.collection);
  if (!failed.includes(undefined)) {
    diagnostics.push(
      ...prepareRelationships(revision, new Set(failed as string[])).flatMap(
        (error) => error.diagnostics,
      ),
    );
  }
  if (diagnostics.length) {
    throw groupDiagnostics(diagnostics);
  }
  return revision;
}
