import { invalidQuery } from "../shared/errors.ts";
import { compare, detachSelection, isScalar } from "../shared/values.ts";
import { encodeCursor } from "../query/cursor.ts";
import {
  effectiveOrder,
  hasSelection,
  NO_SELECTION_MESSAGE,
  PAGINATE_AFTER_LIMIT_MESSAGE,
  type PaginatePlan,
  type QueryPlan,
  type QueryTerminal,
  type SortClause,
} from "../query/plan.ts";
import { matches } from "./filter.ts";
import { relationKey } from "./relationships.ts";
import type { PayloadRequest, PreparedRevision, QueryRecord } from "./revision.ts";

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

/**
 * Orders two entries by their sort values. Null, undefined, and missing values sort last in both
 * directions, preceded by `NaN` and invalid dates; ties fall through to the next clause.
 */
function compareKeys(
  left: readonly unknown[],
  right: readonly unknown[],
  order: readonly SortClause[],
): number {
  for (const [index, sort] of order.entries()) {
    const leftValue = left[index];
    const rightValue = right[index];
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
}

/** An entry with its values for each clause of the scope's effective order. */
type OrderedEntry = { record: QueryRecord; key: unknown[] };

/** Filters and orders one collection or one parent's related candidates, keeping sort keys. */
function orderedEntries(
  records: readonly QueryRecord[],
  plan: QueryPlan,
  revision: PreparedRevision,
  order: readonly SortClause[],
): OrderedEntry[] {
  const entries = records
    .filter((record) =>
      plan.filters.every((expression) => matches(record, expression, revision, plan.collection)),
    )
    .map((record) => ({
      record,
      key: order.map((sort) =>
        Object.hasOwn(record, sort.field) ? record[sort.field] : undefined,
      ),
    }));
  for (const [index, sort] of order.entries()) {
    let category: string | undefined;
    for (const { key } of entries) {
      const value = key[index];
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
    entries.sort((left, right) => compareKeys(left.key, right.key, order));
  }
  return entries;
}

/** Filters, orders, and pages one collection or one parent's related candidates. */
function pageRecords(
  records: readonly QueryRecord[],
  plan: QueryPlan,
  revision: PreparedRevision,
  preserveOrder = false,
): QueryRecord[] {
  if (records.length <= 1 && !plan.order.length) {
    const record = records[0];
    return record &&
      plan.filters.every((expression) => matches(record, expression, revision, plan.collection)) &&
      (plan.offset ?? 0) === 0 &&
      plan.limit !== 0
      ? [record]
      : [];
  }
  const offset = plan.offset ?? 0;
  return orderedEntries(records, plan, revision, effectiveOrder(plan, preserveOrder))
    .slice(offset, plan.limit === undefined ? undefined : offset + plan.limit)
    .map((entry) => entry.record);
}

/** Finds the first position where a predicate that flips from false to true once becomes true. */
function firstIndex<Item>(items: readonly Item[], predicate: (item: Item) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (predicate(items[middle]!)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

/**
 * Selects one page of a root scope's ordered entries and describes where it sits. Page numbers
 * count from 1, and page 1 exists even when nothing matches. Cursors position a page strictly after
 * or before the boundary entry's sort values, so a deleted boundary entry still pages correctly.
 */
function pageOf(
  entries: readonly OrderedEntry[],
  request: PaginatePlan,
  order: readonly SortClause[],
  collection: string,
): { entries: OrderedEntry[]; info: Record<string, unknown> } {
  if (request.mode === "page") {
    const total = entries.length;
    const pageCount = Math.max(1, Math.ceil(total / request.size));
    const start = (request.page - 1) * request.size;
    return {
      entries: entries.slice(start, start + request.size),
      info: {
        total,
        page: request.page,
        pageCount,
        hasNextPage: request.page < pageCount,
        hasPreviousPage: request.page > 1,
      },
    };
  }
  const { key } = request;
  let start: number;
  let end: number;
  if (request.direction === "after") {
    start = key ? firstIndex(entries, (entry) => compareKeys(entry.key, key, order) > 0) : 0;
    end = Math.min(entries.length, start + request.size);
  } else {
    end = key
      ? firstIndex(entries, (entry) => compareKeys(entry.key, key, order) >= 0)
      : entries.length;
    start = Math.max(0, end - request.size);
  }
  const page = entries.slice(start, end);
  return {
    entries: page,
    info: {
      startCursor: page.length ? encodeCursor(collection, order, page[0]!.key) : null,
      endCursor: page.length ? encodeCursor(collection, order, page.at(-1)!.key) : null,
      hasNextPage: end < entries.length,
      hasPreviousPage: start > 0,
      ...(request.total ? { total: entries.length } : {}),
    },
  };
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
  const { scope: neighborsScope, plan: selection } = plan.adjacent!;
  // Results-scope neighbors share the outer filters and order but select their own data.
  const siblingPlan: QueryPlan =
    neighborsScope === "results"
      ? {
          ...plan,
          select: selection.select,
          with: selection.with,
          adjacent: undefined,
          payloads: undefined,
          limit: undefined,
          offset: undefined,
          paginate: undefined,
        }
      : selection;
  const key = neighborsScope === "results" ? plan : siblingPlan;
  let candidates = scopes.get(key);
  if (!candidates) {
    candidates = new WeakMap();
    scopes.set(key, candidates);
  }
  let scope = candidates.get(records);
  if (!scope) {
    const unique = [...new Map(records.map((entry) => [entry.id, entry])).values()];
    const ordered = pageRecords(
      unique,
      siblingPlan,
      revision,
      neighborsScope === "results" && preserveOrder,
    );
    scope = {
      plan: siblingPlan,
      records: ordered,
      positions: new Map(ordered.map((entry, index) => [entry.id, index])),
    };
    candidates.set(records, scope);
  }
  return scope;
}

/**
 * Projects one entry and requested relationships/adjacency from one pinned revision.
 * Requested payloads are recorded for the caller to load after projection.
 */
function project(
  record: QueryRecord,
  plan: QueryPlan,
  revision: PreparedRevision,
  scopes: ProjectionScopes,
  scopeRecords: readonly QueryRecord[],
  requests: PayloadRequest[],
  preserveScopeOrder = false,
): Record<string, unknown> {
  if (!hasSelection(plan)) {
    invalidQuery(NO_SELECTION_MESSAGE);
  }
  const result = detachSelection(record, plan.select ?? []);
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
      project(entry, nested, revision, scopes, candidates, requests, preserveOrder),
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
      plan.adjacent.scope === "results"
        ? scopeRecords
        : revision.collections[plan.collection]!.records;
    const scope = neighborScope(plan, candidates, preserveScopeOrder, scopes, revision);
    const index = scope.positions.get(record.id);
    const previous = index === undefined ? undefined : scope.records[index - 1];
    const next = index === undefined ? undefined : scope.records[index + 1];
    result._adjacent = {
      previous: previous
        ? project(previous, scope.plan, revision, scopes, candidates, requests)
        : null,
      next: next ? project(next, scope.plan, revision, scopes, candidates, requests) : null,
    };
  }
  if (plan.payloads) {
    requests.push({
      target: result,
      collection: plan.collection,
      id: record.id,
      payloads: plan.payloads,
    });
  }
  return result;
}

/**
 * Runs the shared JavaScript executor; future adapters can execute the same plan.
 * Rows that requested payloads are appended to `requests` for loading after execution.
 *
 * @param revision - The pinned revision to read.
 * @param plan - A normalized query plan.
 * @param terminal - `all` returns rows, `first` one row or undefined, `count` a number, and
 * `paginate` the page object for the plan's `paginate` request.
 * @param requests - Collects rows that requested payloads.
 * @returns The terminal's result.
 */
export async function executeQuery(
  revision: PreparedRevision,
  plan: QueryPlan,
  terminal: QueryTerminal,
  requests: PayloadRequest[] = [],
): Promise<unknown> {
  const collection = revision.collections[plan.collection];
  if (!collection) {
    invalidQuery(`Unknown collection "${plan.collection}".`);
  }
  if (terminal === "count") {
    if (plan.payloads) {
      invalidQuery("Counts cannot request payloads.");
    }
    return queryCandidates(collection.records, plan).filter((record) =>
      plan.filters.every((expression) => matches(record, expression, revision, plan.collection)),
    ).length;
  }
  if (!hasSelection(plan)) {
    invalidQuery(NO_SELECTION_MESSAGE);
  }
  const scopes: ProjectionScopes = new WeakMap();
  if (terminal === "paginate") {
    if (!plan.paginate) {
      invalidQuery("paginate requires a page request.");
    }
    if (plan.limit !== undefined || plan.offset !== undefined) {
      invalidQuery(PAGINATE_AFTER_LIMIT_MESSAGE);
    }
    const order = effectiveOrder(plan);
    const { entries, info } = pageOf(
      orderedEntries(queryCandidates(collection.records, plan), plan, revision, order),
      plan.paginate,
      order,
      plan.collection,
    );
    return {
      items: entries.map((entry) =>
        project(entry.record, plan, revision, scopes, collection.records, requests),
      ),
      ...info,
    };
  }
  const records = pageRecords(queryCandidates(collection.records, plan), plan, revision);
  return terminal === "first"
    ? records[0]
      ? project(records[0], plan, revision, scopes, collection.records, requests)
      : undefined
    : records.map((record) =>
        project(record, plan, revision, scopes, collection.records, requests),
      );
}
