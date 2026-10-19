import { ContentError } from "../shared/errors.ts";
import { compareStrings, isScalar } from "../shared/values.ts";
import type { PreparedRevision, QueryRecord } from "./revision.ts";
import type { Relationship } from "../collection/types.ts";

/** Encodes a scalar match key without coercing strings, numbers, dates, or bigint. */
function scalarKey(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (!isScalar(value)) {
    throw new Error("Relationship keys must be scalars or scalar arrays.");
  }
  if (value instanceof Date) {
    return `date:${value.getTime()}`;
  }
  return `${typeof value}:${String(value)}`;
}

/** Formats an authored reference value for diagnostics without its internal type prefix. */
function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return String(value);
}

/** Returns present relationship keys and preserves forward-array multiplicity. */
function references(record: QueryRecord, field: string): { key: string; value: unknown }[] {
  const value = Object.hasOwn(record, field) ? record[field] : undefined;
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    const key = scalarKey(item);
    return key === undefined ? [] : [{ key, value: item }];
  });
}

/** Returns present relationship keys for matching. */
function keys(record: QueryRecord, field: string): string[] {
  return references(record, field).map((reference) => reference.key);
}

/** Indexes all matching values once for batched relationship loading. */
function indexRecords(records: readonly QueryRecord[], field: string): Map<string, QueryRecord[]> {
  const index = new Map<string, QueryRecord[]>();
  for (const record of records) {
    for (const key of new Set(keys(record, field))) {
      const matches = index.get(key) ?? [];
      matches.push(record);
      index.set(key, matches);
    }
  }
  return index;
}

/**
 * Creates all per-entry relationship matches and validates ownership and cardinality,
 * reporting every invalid reference. Relationships touching a collection in `skipped`
 * are not checked, because its missing entries would produce speculative failures.
 */
export function prepareRelationships(
  revision: PreparedRevision,
  skipped: ReadonlySet<string> = new Set(),
): ContentError[] {
  const errors: ContentError[] = [];
  for (const [collectionName, collection] of Object.entries(revision.collections)) {
    for (const [relationshipName, relation] of Object.entries(collection.relationships)) {
      if (skipped.has(collectionName) || skipped.has(relation.collection)) {
        continue;
      }
      /** Records one failure against the entry and field that own the invalid value. */
      const report = (
        message: string,
        owner: { collection: string; entry?: QueryRecord; field: string },
        cause?: unknown,
      ) => {
        errors.push(
          new ContentError({
            code: "invalid-reference",
            operation: "build",
            collection: owner.collection,
            id: owner.entry?.id,
            source: owner.entry
              ? revision.collections[owner.collection]?.sources?.get(owner.entry.id)
              : undefined,
            path: [owner.field],
            message: `Invalid relationship ${collectionName}.${relationshipName}: ${message}`,
            cause,
          }),
        );
      };
      const declaration = { collection: collectionName, field: relation.from };
      const target = revision.collections[relation.collection];
      if (
        !target ||
        !["one", "many"].includes(relation.type) ||
        !["from", "to", "none"].includes(relation.referenceSide) ||
        !relation.from ||
        !relation.to
      ) {
        report("Invalid relationship declaration or unregistered target.", declaration);
        continue;
      }
      if (
        collection.records.some((record) => Array.isArray(record[relation.from])) &&
        target.records.some((record) => Array.isArray(record[relation.to]))
      ) {
        report("Array-to-array relationships are unsupported.", declaration);
        continue;
      }
      let sourceIndex: Map<string, QueryRecord[]>;
      let targetIndex: Map<string, QueryRecord[]>;
      try {
        sourceIndex = indexRecords(collection.records, relation.from);
        targetIndex = indexRecords(target.records, relation.to);
      } catch (cause) {
        report(cause instanceof Error ? cause.message : String(cause), declaration, cause);
        continue;
      }
      // Current entries already reported as owners, so cardinality does not repeat them.
      const reportedOwners = new Set<string>();
      if (relation.referenceSide !== "none") {
        const inverse = relation.referenceSide === "to";
        const owning = inverse ? target : collection;
        const oppositeIndex = inverse ? sourceIndex : targetIndex;
        const owner = {
          collection: inverse ? relation.collection : collectionName,
          field: inverse ? relation.to : relation.from,
        };
        const opposite = inverse ? collectionName : relation.collection;
        for (const record of owning.records) {
          const reported = new Set<string>();
          for (const { key, value } of references(record, owner.field)) {
            const matches = oppositeIndex.get(key)?.length ?? 0;
            if (matches === 1 || reported.has(key)) {
              continue;
            }
            reported.add(key);
            if (!inverse) {
              reportedOwners.add(record.id);
            }
            report(
              matches === 0
                ? `Reference ${describeValue(value)} has no target in "${opposite}".`
                : `Reference ${describeValue(value)} matches ${matches} entries in "${opposite}".`,
              { ...owner, entry: record },
            );
          }
        }
      }
      const matchesById = new Map<string, readonly QueryRecord[]>();
      for (const record of collection.records) {
        const candidates = keys(record, relation.from).flatMap((key) => targetIndex.get(key) ?? []);
        const authoredArray =
          relation.referenceSide === "from" && Array.isArray(record[relation.from]);
        const matches = authoredArray
          ? candidates
          : [...new Set(candidates)].sort((left, right) => compareStrings(left.id, right.id));
        if (relation.type === "one" && matches.length > 1 && !reportedOwners.has(record.id)) {
          report(`A singular relationship has ${matches.length} unfiltered matches.`, {
            ...declaration,
            entry: record,
          });
        }
        matchesById.set(record.id, matches);
      }
      revision.relations.set(relationKey(collectionName, relationshipName), matchesById);
    }
  }
  return errors;
}

/** Builds a collision-free internal lookup key for a declared relationship. */
export function relationKey(collection: string, relationship: string): string {
  return JSON.stringify([collection, relationship]);
}

/** Checks the structural declaration independently from observed entry fields. */
export function isRelationship(value: unknown): value is Relationship {
  return (
    typeof value === "object" &&
    value !== null &&
    "collection" in value &&
    typeof value.collection === "string" &&
    "from" in value &&
    typeof value.from === "string" &&
    "to" in value &&
    typeof value.to === "string" &&
    "type" in value &&
    (value.type === "one" || value.type === "many") &&
    "referenceSide" in value &&
    ["from", "to", "none"].includes(String(value.referenceSide))
  );
}
