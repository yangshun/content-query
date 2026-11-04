import {
  ContentError,
  contentError,
  groupDiagnostics,
  payloadIdentity,
  type ContentDiagnostic,
} from "../shared/errors.ts";
import { builtinLoader } from "../loaders/descriptor.ts";
import { renderMarkdown } from "../runtime/markdown.ts";
import { isRelationship, prepareRelationships } from "../runtime/relationships.ts";
import { detach, encode, valuePath } from "../shared/values.ts";
import {
  variantKey,
  type BuiltinPayload,
  type PreparedCollection,
  type PreparedRevision,
  type QueryRecord,
} from "../runtime/revision.ts";
import { queryRegistry } from "../collection/registry.ts";
import type {
  CollectionDefinition,
  CollectionRegistry,
  PayloadDefinition,
} from "../collection/types.ts";
import type { LoaderEntry } from "../loaders/types.ts";

export type CandidateSources = Map<string, Map<string, LoaderEntry>>;
type PreparedEntry = {
  signature?: string;
  definition: CollectionDefinition;
  record: QueryRecord;
  payload: BuiltinPayload;
  /** Resolved custom payload values by name and canonical variant key, reused while unchanged. */
  payloads?: Map<string, Map<string, unknown>>;
};
/** A custom payload declaration as preparation calls it, independent of its inferred types. */
type Payload = PayloadDefinition<Record<string, unknown>, unknown, Record<string, string>>;
export type PreparationCache = Map<string, PreparedEntry>;

import { isRecord, validate, renderedPayload } from "./validation.ts";

/** Prepares one immutable revision with loader-defined source metadata, aggregating failures. */
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
    const builtins = new Map<string, () => Promise<BuiltinPayload>>();
    const computed = definition.computed ?? {};
    const relationships = definition.relationships ?? {};
    const declarationNames = [...Object.keys(computed), ...Object.keys(relationships)];
    if (
      declarationNames.some((name) => ["id", "_adjacent", "_payloads"].includes(name)) ||
      new Set(declarationNames).size !== declarationNames.length ||
      Object.values(relationships).some((relation) => !isRelationship(relation))
    ) {
      diagnostics.push({
        code: "validation-error",
        operation: "build",
        collection: collectionName,
        message: "Invalid or overlapping computed/relationship declarations.",
      });
      continue;
    }
    const payloadProblem = invalidPayloads(definition.payloads, declarationNames);
    if (payloadProblem) {
      diagnostics.push({
        code: "validation-error",
        operation: "build",
        collection: collectionName,
        message: payloadProblem,
      });
      continue;
    }
    const descriptor = builtinLoader(definition.loader);
    for (const entry of sources.get(collectionName)?.values() ?? []) {
      signal.throwIfAborted();
      const context = {
        operation: "build",
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
          builtins.set(entry.id, async () => previous.payload);
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
          Object.hasOwn(validated, "_payloads") ||
          declarationNames.some((name) => Object.hasOwn(validated, name))
        ) {
          throw new Error(
            "Metadata, computed fields, relationships, and reserved id/_adjacent/_payloads must have distinct names.",
          );
        }
        // Clone as one graph, before exposing data to user resolvers or retaining it.
        const metadata = detach(validated);
        const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
        const before = diagnostics.length;
        for (const [field, computedField] of Object.entries(computed)) {
          try {
            const result = await computedField.resolve({
              collection: collectionName,
              id: entry.id,
              source: detach(entry.sourceData) as never,
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
        const payload: BuiltinPayload = {};
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
          builtins.set(entry.id, async () => payload);
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
      builtins,
      sources: new Map(
        [...(sources.get(collectionName)?.values() ?? [])].map((entry) => [entry.id, entry.source]),
      ),
    };
  }
  signal.throwIfAborted();
  const revision: PreparedRevision = {
    collections,
    registry: queryRegistry(
      Object.fromEntries(Object.keys(collections).map((name) => [name, registry[name]!])),
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
  // Payloads resolve from complete entries, after every collection and relationship validated.
  const unresolved = new Set(diagnostics.map((diagnostic) => diagnostic.collection));
  if (!unresolved.has(undefined)) {
    for (const [collectionName, definition] of Object.entries(registry)) {
      if (!unresolved.has(collectionName) && Object.keys(definition.payloads ?? {}).length) {
        collections[collectionName]!.payloads = await preparePayloads(
          collectionName,
          definition.payloads as Record<string, Payload>,
          collections[collectionName]!.records,
          sources.get(collectionName),
          cache,
          signal,
          diagnostics,
        );
      }
    }
  }
  if (diagnostics.length) {
    throw groupDiagnostics(diagnostics);
  }
  return revision;
}

/**
 * Checks custom payload declarations before any entry is prepared.
 *
 * @param payloads - The collection's payload declarations.
 * @param declarationNames - Computed field and relationship names the payloads must not repeat.
 * @returns A diagnostic message, or undefined when every declaration is valid.
 */
function invalidPayloads(
  payloads: unknown,
  declarationNames: readonly string[],
): string | undefined {
  if (payloads === undefined) {
    return undefined;
  }
  if (!payloads || typeof payloads !== "object" || Array.isArray(payloads)) {
    return "Payloads must be an object of named payload declarations.";
  }
  for (const [name, declaration] of Object.entries(payloads)) {
    if (!name || name.startsWith("_") || declarationNames.includes(name)) {
      return `Custom payload "${name}" must be named without a leading "_" and must not repeat a computed field or relationship.`;
    }
    const { schema, resolve, variants, combinations } = (declaration ?? {}) as Partial<Payload>;
    if (
      !schema ||
      typeof schema !== "object" ||
      !("~standard" in schema) ||
      typeof resolve !== "function"
    ) {
      return `Payload "${name}" requires a schema and a resolve() function.`;
    }
    if (
      variants !== undefined &&
      (!variants ||
        typeof variants !== "object" ||
        Array.isArray(variants) ||
        Object.entries(variants).some(
          ([key, values]) =>
            !key ||
            (typeof values === "string"
              ? !values
              : !Array.isArray(values) ||
                !values.every((value) => typeof value === "string" && value)),
        ))
    ) {
      return `Payload "${name}" variants must map each key to a data field name or a list of values.`;
    }
    if (
      combinations !== undefined &&
      (typeof combinations !== "function" || !Object.keys(variants ?? {}).length)
    ) {
      return `Payload "${name}" combinations() must be a function and requires declared variants.`;
    }
  }
  return undefined;
}

/**
 * Lists an entry's variant combinations: the cross product of each key's values, or the
 * declaration's validated `combinations()` override. A key's values come from a named string-array
 * field of the entry's data, where a missing value means none, or from a fixed list.
 * Combinations have sorted keys.
 *
 * @param name - The payload name, for error messages.
 * @param payload - The payload declaration.
 * @param context - The enumerator context for one entry.
 * @returns Distinct combinations; a payload without variants has exactly one, `{}`.
 */
async function variantCombinations(
  name: string,
  payload: Payload,
  context: Parameters<NonNullable<Payload["combinations"]>>[0],
): Promise<Record<string, string>[]> {
  const keys = Object.keys(payload.variants ?? {}).sort();
  const values: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const key of keys) {
    const source = payload.variants![key]!;
    const listed: unknown = typeof source === "string" ? (context.data[source] ?? []) : source;
    if (!Array.isArray(listed) || !listed.every((value) => typeof value === "string" && value)) {
      const field = typeof source === "string" ? ` in field "${String(source)}"` : "";
      throw new Error(`Variant "${key}" of payload "${name}" must list non-empty strings${field}.`);
    }
    values[key] = [...new Set(listed as string[])];
  }
  let combinations: Record<string, string>[];
  if (payload.combinations) {
    const listed: unknown = await payload.combinations({ ...context, variants: values });
    if (!listed || typeof listed !== "object" || !(Symbol.iterator in listed)) {
      throw new Error(`Payload "${name}" combinations() must return an iterable of variants.`);
    }
    combinations = [...(listed as Iterable<unknown>)].map((combination) => {
      const variant = combination as Record<string, unknown>;
      if (
        !variant ||
        typeof variant !== "object" ||
        Object.keys(variant).length !== keys.length ||
        keys.some((key) => !values[key]!.includes(variant[key] as string))
      ) {
        throw new Error(
          `Each combination of payload "${name}" must give every variant key (${keys.join(", ")}) one enumerated value.`,
        );
      }
      return Object.fromEntries(keys.map((key) => [key, variant[key] as string]));
    });
  } else {
    combinations = keys.reduce<Record<string, string>[]>(
      (partial, key) =>
        partial.flatMap((variant) => values[key]!.map((value) => ({ ...variant, [key]: value }))),
      [{}],
    );
  }
  return [...new Map(combinations.map((variant) => [variantKey(variant), variant])).values()];
}

/**
 * Resolves, validates, and encodes a collection's custom payloads for every entry and variant.
 * Entries unchanged since the previous revision reuse their cached values.
 *
 * @returns Lazy loaders by payload name, entry ID, and canonical variant key.
 */
async function preparePayloads(
  collection: string,
  payloads: Readonly<Record<string, Payload>>,
  records: readonly QueryRecord[],
  sources: ReadonlyMap<string, LoaderEntry> | undefined,
  cache: PreparationCache,
  signal: AbortSignal,
  diagnostics: ContentDiagnostic[],
): Promise<PreparedCollection["payloads"]> {
  const table = new Map(
    Object.keys(payloads).map((name) => [
      name,
      new Map<string, Map<string, () => Promise<unknown>>>(),
    ]),
  );
  for (const record of records) {
    const entry = sources?.get(record.id);
    const cached = cache.get(JSON.stringify([collection, record.id]));
    // Resolvers receive metadata plus computed fields; the ID is a separate context property.
    const data = Object.fromEntries(Object.entries(record).filter(([field]) => field !== "id"));
    for (const [name, payload] of Object.entries(payloads)) {
      signal.throwIfAborted();
      let values = cached?.payloads?.get(name);
      if (!values) {
        const resolved = new Map<string, unknown>();
        let complete = true;
        const base: ContentDiagnostic = {
          code: "validation-error",
          operation: "build",
          collection,
          id: record.id,
          source: entry?.source,
          payload: name,
          message: "",
        };
        /** Each resolver receives its own copies, so it cannot change another's inputs. */
        const context = () => ({
          collection,
          id: record.id,
          source: detach(entry?.sourceData) as never,
          data: detach(data),
          signal,
        });
        let combinations: Record<string, string>[] = [];
        try {
          combinations = await variantCombinations(name, payload, { ...context(), variants: {} });
        } catch (cause) {
          complete = false;
          diagnostics.push(
            ...contentError(cause, {
              ...base,
              message:
                cause instanceof Error ? cause.message : `Payload "${name}" variants failed.`,
            }).diagnostics,
          );
        }
        for (const variant of combinations) {
          signal.throwIfAborted();
          const location = { ...base, variant };
          try {
            const result = await payload.resolve({
              ...context(),
              variant: { ...variant },
              readBody: async () => entry?.body,
            });
            const value = detach(await validate(payload.schema, result, location));
            encode(value);
            resolved.set(variantKey(variant), value);
          } catch (cause) {
            complete = false;
            const formatted =
              cause &&
              typeof cause === "object" &&
              "path" in cause &&
              typeof cause.path === "string"
                ? cause.path
                : "";
            diagnostics.push(
              ...contentError(cause, {
                ...location,
                path: formatted ? valuePath(formatted) : undefined,
                message: `Payload ${payloadIdentity(name, variant)} failed: ${cause instanceof Error ? cause.message : String(cause)}${formatted ? ` (at ${formatted})` : ""}`,
              }).diagnostics,
            );
          }
        }
        signal.throwIfAborted();
        if (!complete) {
          continue;
        }
        values = resolved;
        if (cached) {
          cached.payloads ??= new Map();
          cached.payloads.set(name, values);
        }
      }
      table
        .get(name)!
        .set(record.id, new Map([...values].map(([key, value]) => [key, async () => value])));
    }
  }
  return table;
}
