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
  | "array-contains"
  | "array-contains-any"
  | "array-contains-all"
  | "is-null"
  | "is-undefined"
  | "is-missing";
export type Expression =
  | { kind: "predicate"; operator: PredicateOperator; field: string; value?: unknown }
  | { kind: "and" | "or" | "not"; expressions: readonly Expression[] };

export type QueryPlan = {
  collection: string;
  select?: readonly string[];
  filters: readonly Expression[];
  order: readonly { field: string; direction: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
  with: Readonly<Record<string, QueryPlan>>;
  adjacent?: true | QueryPlan;
};

export type QueryRunner = (
  plan: QueryPlan,
  terminal: "all" | "first" | "count",
) => Promise<unknown>;
export type QueryRegistry = Record<string, { relationships: Record<string, Relationship> }>;

/** Starts a fresh query without binding a content revision until execution. */
export function emptyPlan(collection: string): QueryPlan {
  return { collection, filters: [], order: [], with: {} };
}

/** Treats explicitly selected relationships and adjacency as row projections too. */
export function hasSelection(plan: QueryPlan | undefined): plan is QueryPlan {
  return (
    !!plan && (plan.select !== undefined || !!plan.adjacent || Object.keys(plan.with).length > 0)
  );
}
