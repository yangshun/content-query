import type { Relationship } from "../collection/types.ts";

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
  adjacent?: true | QueryPlan;
  /** Payloads to attach under `_payloads` after filtering, ordering, and pagination. */
  payloads?: Readonly<Record<string, PlanPayload>>;
};
/** One requested payload; variant keys are empty for payloads without variants. */
export type PlanPayload = { variant: Readonly<Record<string, string>> };

export type QueryRunner = (
  plan: QueryPlan,
  terminal: "all" | "first" | "count",
) => Promise<unknown>;
/** Describes a payload that queries may request, without its resolver or schema. */
export type PayloadDescriptor = { variants: readonly string[] };
export type QueryRegistry = Record<
  string,
  {
    relationships: Record<string, Relationship>;
    /** Payload names available to queries; omitted when the collection has none. */
    payloads?: Record<string, PayloadDescriptor>;
  }
>;

/** Starts a fresh query without binding a content revision until execution. */
export function emptyPlan(collection: string): QueryPlan {
  return { collection, filters: [], order: [], with: {} };
}

/** Explains the explicit-selection rule wherever a scope returns rows without selecting data. */
export const NO_SELECTION_MESSAGE =
  "Select fields, relationships, payloads, or adjacent entries before running this query." as const;

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
