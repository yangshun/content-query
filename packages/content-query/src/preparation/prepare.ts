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
import path from "node:path";
import { createEntryFiles, entryFolder, type Dependency } from "./files.ts";

export type CandidateSources = Map<string, Map<string, LoaderEntry>>;
/** One resolved payload variant: its value, encoded module text, and the files it read. */
export type PayloadNode = { value: unknown; encoded: string; dependencies: readonly Dependency[] };
/** A payload's variant combinations for one entry and the variants resolved so far. */
export type CachedPayload = {
  combinations: readonly Record<string, string>[];
  nodes: Map<string, PayloadNode>;
};
export type PreparedEntry = {
  signature?: string;
  definition: CollectionDefinition;
  record: QueryRecord;
  payload: BuiltinPayload;
  /** Files computed resolvers read; an edit to one re-prepares the whole entry. */
  dependencies: readonly Dependency[];
  /** Resolved custom payloads by name, reused per variant while unchanged. */
  payloads?: Map<string, CachedPayload>;
};
/** A custom payload declaration as preparation calls it, independent of its inferred types. */
type Payload = PayloadDefinition<Record<string, unknown>, unknown, Record<string, string>>;
export type PreparationCache = Map<string, PreparedEntry>;

import { isRecord, validate, renderedPayload } from "./validation.ts";

/**
 * Prepares one immutable revision with loader-defined source metadata, aggregating failures.
 * `root` is the project root that entry folders and `sharedFiles` resolve against.
 */
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
  { root = process.cwd() }: { root?: string } = {},
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
    const payloadProblem =
      invalidPayloads(definition.payloads, declarationNames) ??
      invalidSharedFiles(definition.sharedFiles);
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
    const shared = (definition.sharedFiles ?? []).map((directory) => path.resolve(root, directory));
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
        // Files computed resolvers read belong to the entry: editing one re-prepares it.
        const dependencies: Dependency[] = [];
        const files = createEntryFiles({
          root,
          folder: entryFolder(root, entry.sourceData),
          shared,
          entry: entry.id,
          signal,
          dependencies,
        });
        for (const [field, computedField] of Object.entries(computed)) {
          try {
            const result = await computedField.resolve({
              collection: collectionName,
              id: entry.id,
              source: detach(entry.sourceData) as never,
              data: detach(metadata) as never,
              readBody: async () => entry.body,
              files,
              signal,
            });
            values[field] = await validate(computedField.schema, result, {
              ...context,
              path: [field],
            });
          } catch (cause) {
            diagnostics.push(
              ...located(cause, {
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
        cache.set(key, { definition, signature, record, payload, dependencies });
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
          {
            root,
            shared: (definition.sharedFiles ?? []).map((directory) =>
              path.resolve(root, directory),
            ),
          },
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
    const { schema, resolve, variants, combinations, cache } = (declaration ??
      {}) as Partial<Payload>;
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
    if (cache !== undefined && typeof cache !== "boolean") {
      return `Payload "${name}" cache must be a boolean.`;
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
 * Adds the location of a resolver failure to every diagnostic that lacks it. A `files` helper error
 * keeps its own source file and field path; the entry, payload, and variant come from `location`.
 *
 * @param cause - The resolver failure.
 * @param location - The entry, and the payload and variant when resolving one.
 * @returns A contextual error whose diagnostics all name the location.
 */
function located(cause: unknown, location: ContentDiagnostic): ContentError {
  if (!(cause instanceof ContentError)) {
    return contentError(cause, location);
  }
  return groupDiagnostics(
    cause.diagnostics.map((diagnostic) => ({
      ...location,
      ...Object.fromEntries(Object.entries(diagnostic).filter(([, value]) => value !== undefined)),
    })),
  );
}

/**
 * Checks a collection's `sharedFiles` directories.
 *
 * @param sharedFiles - The declared shared directories.
 * @returns A diagnostic message, or undefined when the declaration is valid.
 */
function invalidSharedFiles(sharedFiles: unknown): string | undefined {
  if (
    sharedFiles !== undefined &&
    (!Array.isArray(sharedFiles) ||
      !sharedFiles.every((directory) => typeof directory === "string" && directory))
  ) {
    return "sharedFiles must list directories as nonempty strings.";
  }
  return undefined;
}

/** A payload loader that also carries its encoded module text, so publishing skips re-encoding. */
export type PayloadLoader = (() => Promise<unknown>) & { readonly encoded?: string };

/**
 * Resolves, validates, and encodes a collection's custom payloads for every entry and variant.
 * Each variant is cached on its own with the files it read, so unchanged entries reuse every
 * variant and an invalidated variant re-resolves alone.
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
  roots: { root: string; shared: readonly string[] },
): Promise<PreparedCollection["payloads"]> {
  const table = new Map(
    Object.keys(payloads).map((name) => [name, new Map<string, Map<string, PayloadLoader>>()]),
  );
  for (const record of records) {
    const entry = sources?.get(record.id);
    const cached = cache.get(JSON.stringify([collection, record.id]));
    // Resolvers receive metadata plus computed fields; the ID is a separate context property.
    const data = Object.fromEntries(Object.entries(record).filter(([field]) => field !== "id"));
    const folder = entryFolder(roots.root, entry?.sourceData);
    /** Each resolver receives its own copies, so it cannot change another's inputs. */
    const context = () => ({
      collection,
      id: record.id,
      source: detach(entry?.sourceData) as never,
      data: detach(data),
      signal,
    });
    for (const [name, payload] of Object.entries(payloads)) {
      signal.throwIfAborted();
      const reuse = payload.cache !== false;
      const previous = reuse ? cached?.payloads?.get(name) : undefined;
      const base: ContentDiagnostic = {
        code: "validation-error",
        operation: "build",
        collection,
        id: record.id,
        source: entry?.source,
        payload: name,
        message: "",
      };
      let combinations = previous?.combinations;
      if (!combinations) {
        try {
          combinations = await variantCombinations(name, payload, { ...context(), variants: {} });
        } catch (cause) {
          diagnostics.push(
            ...contentError(cause, {
              ...base,
              message:
                cause instanceof Error ? cause.message : `Payload "${name}" variants failed.`,
            }).diagnostics,
          );
          continue;
        }
      }
      const nodes = new Map<string, PayloadNode>();
      let complete = true;
      for (const variant of combinations) {
        signal.throwIfAborted();
        const key = variantKey(variant);
        const reused = previous?.nodes.get(key);
        if (reused) {
          nodes.set(key, reused);
          continue;
        }
        const location = { ...base, variant };
        const dependencies: Dependency[] = [];
        try {
          const result = await payload.resolve({
            ...context(),
            variant: { ...variant },
            readBody: async () => entry?.body,
            files: createEntryFiles({
              root: roots.root,
              folder,
              shared: roots.shared,
              entry: record.id,
              signal,
              dependencies,
            }),
          });
          const value = detach(await validate(payload.schema, result, location));
          nodes.set(key, { value, encoded: encode(value), dependencies });
        } catch (cause) {
          complete = false;
          const formatted =
            cause && typeof cause === "object" && "path" in cause && typeof cause.path === "string"
              ? cause.path
              : "";
          diagnostics.push(
            ...located(cause, {
              ...location,
              path: formatted ? valuePath(formatted) : undefined,
              message: `Payload ${payloadIdentity(name, variant)} failed: ${cause instanceof Error ? cause.message : String(cause)}${formatted ? ` (at ${formatted})` : ""}`,
            }).diagnostics,
          );
        }
      }
      signal.throwIfAborted();
      // Resolved variants are kept even when another fails, so a retry resolves only the failures.
      if (cached && reuse) {
        cached.payloads ??= new Map();
        cached.payloads.set(name, { combinations, nodes });
      }
      if (!complete) {
        continue;
      }
      table
        .get(name)!
        .set(
          record.id,
          new Map(
            [...nodes].map(([key, node]) => [
              key,
              Object.assign(async () => node.value, { encoded: node.encoded }),
            ]),
          ),
        );
    }
  }
  return table;
}
