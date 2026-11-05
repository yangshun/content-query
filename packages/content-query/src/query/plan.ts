import { exportNameOf } from "../collection/names.ts";
import type { Relationship } from "../collection/types.ts";
import { invalidQuery } from "../shared/errors.ts";

export type PredicateOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in-array"
  | "not-in-array"
  | "contains"
  | "starts-with"
  | "ends-with"
  | "like"
  | "ilike"
  | "array-contains"
  | "array-contains-any"
  | "array-contains-all"
  | "array-contained"
  | "is-null"
  | "is-undefined"
  | "is-missing";
export type Expression =
  | { kind: "predicate"; operator: PredicateOperator; field: string; value?: unknown }
  | { kind: "relation"; collection: string; field: string; target: string; expression: Expression }
  /** A fluent `has()` filter that query builders resolve into a `relation` expression. */
  | { kind: "has"; field: string; expression: Expression }
  | { kind: "and" | "or" | "not"; expressions: readonly Expression[] };

export type QueryPlan = {
  collection: string;
  /** Explicitly selected fields; scopes never include unselected fields, including `id`. */
  select?: readonly string[];
  filters: readonly Expression[];
  order: readonly { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  with: Readonly<Record<string, QueryPlan>>;
  adjacent?: AdjacentPlan;
  /** Payloads to attach under `_payloads` after filtering, ordering, and pagination. */
  payloads?: Readonly<Record<string, PlanPayload>>;
  /** A root `paginate()` request; plans that carry it never set `limit` or `offset`. */
  paginate?: PaginatePlan;
};
/** One sort clause in a plan's effective order. */
export type SortClause = { field: string; direction: "asc" | "desc" };
/**
 * A page-number or cursor page request. Cursor keys are already decoded into the sort values of the
 * boundary entry, in effective-order position, so backends never parse cursor strings.
 */
export type PaginatePlan =
  | { mode: "page"; page: number; size: number }
  | {
      mode: "cursor";
      size: number;
      /** `after` pages forward from `key`; `before` pages backward to it. */
      direction: "after" | "before";
      /** Sort values of the boundary entry; omitted to start at the first or last entry. */
      key?: readonly unknown[];
      /** Whether the result includes the filtered total. */
      total: boolean;
    };
/**
 * Selects previous and next entries. `results` finds neighbors within the scope's own filtered and
 * ordered entries, or a parent's related entries, and `plan` holds only their selection;
 * `collection` finds neighbors in an independent sibling scope described by `plan`.
 */
export type AdjacentPlan = { scope: "results" | "collection"; plan: QueryPlan };
/** One requested payload; variant keys are empty for payloads without variants. */
export type PlanPayload = { variant: Readonly<Record<string, string>> };

/** How a plan returns its results; `paginate` requires the plan's `paginate` request. */
export type QueryTerminal = "all" | "first" | "count" | "paginate";
export type QueryRunner = (plan: QueryPlan, terminal: QueryTerminal) => Promise<unknown>;
/** Describes a payload that queries may request, without its resolver or schema. */
export type PayloadDescriptor = { variants: readonly string[] };
export type QueryRegistry = Record<
  string,
  {
    relationships: Record<string, Relationship>;
    /** Payload names available to queries; omitted when the collection has none. */
    payloads?: Record<string, PayloadDescriptor>;
    /**
     * Declared relationships whose target collection this query scope has not loaded, by name, with
     * the target collection. Queries that use one report which collection to pass to `using()`.
     */
    unavailable?: Record<string, string>;
    /** The declared `typeName`, which only generated declarations read. */
    typeName?: string;
  }
>;

/**
 * Rejects a declared relationship whose target collection this query scope has not loaded,
 * naming the collection to pass to `using()`.
 *
 * @param registry - The query scope's registry.
 * @param collection - The collection that declares the relationship.
 * @param name - The relationship, field, or filter name a query used.
 */
export function assertAvailable(registry: QueryRegistry, collection: string, name: string): void {
  const unavailable = registry[collection]?.unavailable;
  if (!unavailable || !Object.hasOwn(unavailable, name)) {
    return;
  }
  const target = exportNameOf(unavailable[name]!);
  invalidQuery(
    `Relationship "${name}" targets the ${target} collection, which this query has not loaded. Pass it to using(), such as ${exportNameOf(collection)}.using(${target}).`,
  );
}

/** Starts a fresh query without binding a content revision until execution. */
export function emptyPlan(collection: string): QueryPlan {
  return { collection, filters: [], order: [], with: {} };
}

/** Explains the explicit-selection rule wherever a scope returns rows without selecting data. */
export const NO_SELECTION_MESSAGE =
  "Select fields, relationships, payloads, or adjacent entries before running this query." as const;

/** Explains why `paginate()` is unavailable once a query sets its own limit or offset. */
export const PAGINATE_AFTER_LIMIT_MESSAGE =
  "paginate() sets the limit and offset itself; remove limit and offset from this query." as const;

/**
 * Returns the order a scope's entries follow: explicit clauses, then ascending ID as the final
 * tie-breaker unless ID is already sorted. Scopes without clauses sort by ascending ID, except
 * relationship scopes that preserve an authored ID array's order.
 *
 * @param plan - The scope whose order to resolve.
 * @param preserveOrder - Keeps authored order when the scope has no explicit clauses.
 * @returns The sort clauses to apply, in priority order.
 */
export function effectiveOrder(plan: QueryPlan, preserveOrder = false): SortClause[] {
  if (!plan.order.length) {
    return preserveOrder ? [] : [{ field: "id", direction: "asc" }];
  }
  const order = [...plan.order];
  if (!order.some((sort) => sort.field === "id")) {
    order.push({ field: "id", direction: "asc" });
  }
  return order;
}

/**
 * Checks whether a row-returning scope explicitly requests data. Nothing is implicit, not even
 * `id`: a scope must select fields, include a relationship, request a payload, or select adjacency.
 *
 * @param plan - The scope to check; `undefined` when a callback returned no builder.
 * @returns `true` when the scope requests at least one kind of data.
 */
export function hasSelection(plan: QueryPlan | undefined): plan is QueryPlan {
  return (
    !!plan &&
    (!!plan.select?.length ||
      !!plan.adjacent ||
      Object.keys(plan.with).length > 0 ||
      Object.keys(plan.payloads ?? {}).length > 0)
  );
}
