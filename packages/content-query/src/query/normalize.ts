import type { Expression, QueryPlan } from "./plan.ts";

/** Flattens conjunctions so repeated fluent where clauses and object fields share a plan. */
function conjunction(expression: Expression): Expression[] {
  return expression.kind === "and" ? expression.expressions.flatMap(conjunction) : [expression];
}

/** Normalizes both query frontends at their common execution boundary. */
export function normalizePlan(plan: QueryPlan): QueryPlan {
  return {
    ...plan,
    ...(plan.select === undefined && Object.keys(plan.with).length ? { select: [] } : {}),
    filters: plan.filters.flatMap(conjunction),
    with: Object.fromEntries(
      Object.entries(plan.with).map(([name, nested]) => [name, normalizePlan(nested)]),
    ),
    ...(plan.adjacent && plan.adjacent !== true ? { adjacent: normalizePlan(plan.adjacent) } : {}),
  };
}
