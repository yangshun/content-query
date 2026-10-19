import { invalidQuery } from "../shared/errors.ts";
import type { QueryPlan, QueryRegistry } from "./plan.ts";

/** Checks scalar field selection for both public query frontends without a schema field catalog. */
export function checkedFields(
  registry: QueryRegistry,
  collection: string,
  fields: string[],
): string[] {
  const scope = registry[collection];
  if (
    !scope ||
    fields.some(
      (field) =>
        typeof field !== "string" ||
        !field ||
        field === "_adjacent" ||
        Object.hasOwn(scope.relationships, field),
    ) ||
    new Set(fields).size !== fields.length
  ) {
    invalidQuery(
      "Selection requires distinct prepared fields; use relationship or adjacency selection explicitly.",
    );
  }
  return [...fields];
}

/** Checks one sort clause with the same cardinality and duplicate rules in either API. */
export function checkedOrder(
  plan: QueryPlan,
  field: string,
  direction: "asc" | "desc",
  many: boolean,
): QueryPlan["order"] {
  if (
    !many ||
    typeof field !== "string" ||
    !field ||
    !["asc", "desc"].includes(direction) ||
    plan.order.some((sort) => sort.field === field)
  ) {
    invalidQuery("Invalid or repeated sort, or sorting a singular relationship.");
  }
  return [...plan.order, { field, direction }];
}

/** Checks pagination before either frontend constructs its shared query plan. */
export function checkedPagination(value: number, many: boolean): number {
  if (!many || !Number.isSafeInteger(value) || value < 0) {
    invalidQuery("Pagination requires a nonnegative safe integer and a many-valued scope.");
  }
  return value;
}
