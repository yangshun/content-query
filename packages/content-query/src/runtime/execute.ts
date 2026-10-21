import { invalidQuery } from "../shared/errors.ts";
import { compare, detachSelection, isScalar } from "../shared/values.ts";
import type { QueryPlan } from "../query/plan.ts";
import { matches } from "./filter.ts";
import { relationKey } from "./relationships.ts";
import type { PreparedRevision, QueryRecord } from "./revision.ts";

const recordIndexes = new WeakMap<readonly QueryRecord[], ReadonlyMap<string, QueryRecord>>();

/** Narrows root ID-equality queries using one lazy index per immutable collection revision. */
function queryCandidates(records: readonly QueryRecord[], plan: QueryPlan): readonly QueryRecord[] {
  const equality = plan.filters.find(
    (expression) =>
      expression.kind === "predicate" &&
      expression.field === "id" &&
      expression.operator === "eq" &&
      typeof expression.value === "string",
  );
  if (equality?.kind !== "predicate" || typeof equality.value !== "string") {
    return records;
  }
  let index = recordIndexes.get(records);
  if (!index) {
    index = new Map(records.map((record) => [record.id, record]));
    recordIndexes.set(records, index);
  }
  const record = index.get(equality.value);
  return record ? [record] : [];
}

/** Classifies nullish and unordered special values for direction-independent placement. */
function sortGroup(value: unknown): number {
  return value == null
    ? 2
    : (typeof value === "number" && Number.isNaN(value)) ||
        (value instanceof Date && Number.isNaN(value.getTime()))
      ? 1
      : 0;
}

/** Filters, orders, and pages one collection or one parent's related candidates. */
function pageRecords(
  records: readonly QueryRecord[],
  plan: QueryPlan,
  revision: PreparedRevision,
  preserveOrder = false,
): QueryRecord[] {
  const filtered = records.filter((record) =>
    plan.filters.every((expression) => matches(record, expression, revision, plan.collection)),
  );
  const order = plan.order.length
    ? [...plan.order]
    : preserveOrder
      ? []
      : [{ field: "id", direction: "asc" as const }];
  if (order.length && !order.some((sort) => sort.field === "id")) {
    order.push({ field: "id", direction: "asc" });
  }
  for (const sort of order) {
    let category: string | undefined;
    for (const record of filtered) {
      const value = Object.hasOwn(record, sort.field) ? record[sort.field] : undefined;
      if (!isScalar(value)) {
        invalidQuery(`Field "${sort.field}" is not sortable.`);
      }
      if (value != null) {
        const current = value instanceof Date ? "date" : typeof value;
        if (category && category !== current) {
          invalidQuery(`Field "${sort.field}" has mixed sort categories.`);
        }
        category = current;
      }
    }
  }
  if (order.length) {
    filtered.sort((left, right) => {
      for (const sort of order) {
        const leftValue = Object.hasOwn(left, sort.field) ? left[sort.field] : undefined;
        const rightValue = Object.hasOwn(right, sort.field) ? right[sort.field] : undefined;
        const group = sortGroup(leftValue) - sortGroup(rightValue);
        if (group) {
          return group;
        }
        if (sortGroup(leftValue) !== 0) {
          continue;
        }
        const comparison = compare(leftValue, rightValue) ?? 0;
        if (comparison) {
          return sort.direction === "desc" ? -comparison : comparison;
        }
      }
      return 0;
    });
  }
  const offset = plan.offset ?? 0;
  return filtered.slice(offset, plan.limit === undefined ? undefined : offset + plan.limit);
}

type NeighborScope = { plan: QueryPlan; records: QueryRecord[]; positions: Map<string, number> };
type ProjectionScopes = WeakMap<QueryPlan, WeakMap<readonly QueryRecord[], NeighborScope>>;

/** Builds a sibling index once per scope, before pagination and within the pinned revision. */
function neighborScope(
  plan: QueryPlan,
  records: readonly QueryRecord[],
  preserveOrder: boolean,
  scopes: ProjectionScopes,
  revision: PreparedRevision,
): NeighborScope {
  const selection = plan.adjacent!;
  const siblingPlan: QueryPlan =
    selection === true
      ? {
          ...plan,
          select: ["id"],
          allFields: undefined,
          exclude: undefined,
          with: {},
          adjacent: undefined,
          limit: undefined,
          offset: undefined,
        }
      : selection;
  const key = selection === true ? plan : siblingPlan;
  let candidates = scopes.get(key);
  if (!candidates) {
    candidates = new WeakMap();
    scopes.set(key, candidates);
  }
  let scope = candidates.get(records);
  if (!scope) {
    const unique = [...new Map(records.map((entry) => [entry.id, entry])).values()];
    const ordered = pageRecords(unique, siblingPlan, revision, selection === true && preserveOrder);
    scope = {
      plan: siblingPlan,
      records: ordered,
      positions: new Map(ordered.map((entry, index) => [entry.id, index])),
    };
    candidates.set(records, scope);
  }
  return scope;
}

/** Projects one entry and requested relationships/adjacency from one pinned revision. */
function project(
  record: QueryRecord,
  plan: QueryPlan,
  revision: PreparedRevision,
  scopes: ProjectionScopes,
  scopeRecords: readonly QueryRecord[],
  preserveScopeOrder = false,
): Record<string, unknown> {
  if (!plan.select && !plan.allFields && !plan.adjacent) {
    invalidQuery("Row-returning queries require select().");
  }
  const fields = plan.allFields
    ? Object.keys(record).filter((field) => !plan.exclude?.includes(field))
    : (plan.select ?? []);
  const result = detachSelection(record, fields);
  for (const [name, nested] of Object.entries(plan.with)) {
    const relation = revision.registry[plan.collection]!.relationships[name]!;
    if (
      !relation ||
      relation.collection !== nested.collection ||
      (relation.type === "one" &&
        (nested.limit !== undefined || nested.offset !== undefined || nested.order.length > 0))
    ) {
      invalidQuery(`Relationship "${name}" no longer matches the prepared query scope.`);
    }
    const candidates =
      revision.relations.get(relationKey(plan.collection, name))?.get(record.id) ?? [];
    const preserveOrder = relation.referenceSide === "from" && Array.isArray(record[relation.from]);
    const selected = pageRecords(candidates, nested, revision, preserveOrder).map((entry) =>
      project(entry, nested, revision, scopes, candidates, preserveOrder),
    );
    Object.defineProperty(result, name, {
      value: relation.type === "many" ? selected : (selected[0] ?? null),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (plan.adjacent) {
    const candidates =
      plan.adjacent === true ? scopeRecords : revision.collections[plan.collection]!.records;
    const scope = neighborScope(plan, candidates, preserveScopeOrder, scopes, revision);
    const index = scope.positions.get(record.id);
    const previous = index === undefined ? undefined : scope.records[index - 1];
    const next = index === undefined ? undefined : scope.records[index + 1];
    result._adjacent = {
      previous: previous ? project(previous, scope.plan, revision, scopes, candidates) : null,
      next: next ? project(next, scope.plan, revision, scopes, candidates) : null,
    };
  }
  return result;
}

/** Runs the shared JavaScript executor; future adapters can execute the same plan. */
export async function executeQuery(
  revision: PreparedRevision,
  plan: QueryPlan,
  terminal: "all" | "first" | "count",
): Promise<unknown> {
  const collection = revision.collections[plan.collection];
  if (!collection) {
    invalidQuery(`Unknown collection "${plan.collection}".`);
  }
  if (terminal === "count") {
    return queryCandidates(collection.records, plan).filter((record) =>
      plan.filters.every((expression) => matches(record, expression, revision, plan.collection)),
    ).length;
  }
  if (!plan.select && !plan.allFields && !plan.adjacent) {
    invalidQuery("Row-returning queries require select().");
  }
  const records = pageRecords(queryCandidates(collection.records, plan), plan, revision);
  const scopes: ProjectionScopes = new WeakMap();
  return terminal === "first"
    ? records[0]
      ? project(records[0], plan, revision, scopes, collection.records)
      : undefined
    : records.map((record) => project(record, plan, revision, scopes, collection.records));
}
