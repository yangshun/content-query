import { invalidQuery } from "../shared/errors.ts";
import { detach, isScalar } from "../shared/values.ts";
import { and, fieldProxy, not, or, resolveRelations, validateExpression } from "./operators.ts";
import { checkedFields, checkedOrder, checkedPagination } from "./clauses.ts";
import {
  emptyPlan,
  hasSelection,
  type AdjacentPlan,
  type Expression,
  type PredicateOperator,
  type QueryPlan,
  type QueryRegistry,
} from "./plan.ts";

const operators: Record<string, PredicateOperator> = {
  equals: "eq",
  not: "ne",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  in: "in-array",
  notIn: "not-in-array",
  contains: "contains",
  startsWith: "starts-with",
  endsWith: "ends-with",
  has: "array-contains",
  hasSome: "array-contains-any",
  hasEvery: "array-contains-all",
  isNull: "is-null",
  isUndefined: "is-undefined",
  isMissing: "is-missing",
};

/** Requires a plain options record, rejecting arrays and class instances at API boundaries. */
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    invalidQuery(`${label} must be an options object.`);
  }
}

/** Converts object predicates to the same validated expressions used by fluent operators. */
export function objectWhere(where: unknown): Expression {
  record(where, "where");
  const expressions: Expression[] = [];
  for (const [field, condition] of Object.entries(where)) {
    if (["AND", "OR", "NOT"].includes(field)) {
      const children = (Array.isArray(condition) ? condition : [condition]).map(objectWhere);
      expressions.push(
        field === "OR"
          ? or(...children)
          : field === "NOT"
            ? and(...children.map(not))
            : and(...children),
      );
      continue;
    }
    if (isScalar(condition)) {
      expressions.push({ kind: "predicate", operator: "eq", field, value: condition });
      continue;
    }
    record(condition, `Filter for "${field}"`);
    for (const [name, value] of Object.entries(condition)) {
      if (!Object.hasOwn(operators, name)) {
        invalidQuery(`Unknown filter operator "${name}".`);
      }
      if (name === "not" && !isScalar(value)) {
        expressions.push(not(objectWhere({ [field]: value })));
        continue;
      }
      const expression: Expression = {
        kind: "predicate",
        operator: operators[name]!,
        field,
        value,
      };
      if (name.startsWith("is")) {
        if (typeof value !== "boolean") {
          invalidQuery("Presence predicates require a boolean.");
        }
        expressions.push(value ? expression : not(expression));
      } else {
        expressions.push(expression);
      }
    }
  }
  const expression = and(...expressions);
  validateExpression(expression);
  return detach(expression);
}

/** Compiles explicit object options into the backend-independent fluent query contract. */
/**
 * Compiles an object-form `_adjacent` selection. `{ scope: "results", select }` selects neighbors
 * within the current results; other options describe an independent sibling scope.
 *
 * @param registry - The query registry.
 * @param collection - The collection whose neighbors are selected.
 * @param selection - The `_adjacent` value from an object selection.
 * @returns The adjacency plan, which always selects explicit data.
 */
function objectAdjacent(
  registry: QueryRegistry,
  collection: string,
  selection: unknown,
): AdjacentPlan {
  record(selection, "_adjacent");
  const { scope, ...options } = selection;
  if (scope !== undefined && scope !== "results" && scope !== "collection") {
    invalidQuery('Adjacent scope must be "results" or "collection".');
  }
  if (scope === "results" && Object.keys(options).some((key) => key !== "select")) {
    invalidQuery(
      "Results-scope neighbors only select data; they share the query's filters and order.",
    );
  }
  const plan = objectPlan(registry, collection, options, true, false, false);
  if (!hasSelection(plan)) {
    invalidQuery("Adjacent entries require explicit selection.");
  }
  return { scope: scope === "results" ? "results" : "collection", plan };
}

export function objectPlan(
  registry: QueryRegistry,
  collection: string,
  options: unknown,
  many = true,
  allowAdjacent = true,
  pagination = true,
): QueryPlan {
  if (!Object.hasOwn(registry, collection)) {
    invalidQuery(`Unknown collection "${collection}".`);
  }
  record(options, "Query");
  const allowed = ["where", "select", "orderBy", ...(pagination ? ["limit", "offset"] : [])];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    invalidQuery("Unknown query option or pagination in an adjacency scope.");
  }
  let plan = emptyPlan(collection);
  if (options.where !== undefined) {
    const expression =
      typeof options.where === "function"
        ? (options.where(fieldProxy()) as Expression)
        : objectWhere(options.where);
    validateExpression(expression);
    plan.filters = [detach(resolveRelations(registry, collection, expression))];
  }
  if (options.orderBy !== undefined) {
    for (const order of Array.isArray(options.orderBy) ? options.orderBy : [options.orderBy]) {
      record(order, "orderBy");
      if (!Object.keys(order).length) {
        invalidQuery("orderBy requires a field.");
      }
      for (const [field, direction] of Object.entries(order)) {
        plan.order = checkedOrder(plan, field, direction as "asc" | "desc", many);
      }
    }
  }
  for (const key of ["limit", "offset"] as const) {
    if (options[key] !== undefined) {
      plan[key] = checkedPagination(options[key] as number, many);
    }
  }
  if (options.select !== undefined) {
    record(options.select, "select");
    const selected = Object.entries(options.select).filter(
      ([, value]) => value !== false && value !== undefined,
    );
    if (!selected.length) {
      invalidQuery("Row-returning queries require a nonempty selection.");
    }
    const fields: string[] = [];
    const related: Record<string, QueryPlan> = Object.create(null) as Record<string, QueryPlan>;
    for (const [name, selection] of selected) {
      if (name === "_adjacent") {
        if (!allowAdjacent) {
          invalidQuery("Adjacency cannot be selected recursively.");
        }
        plan.adjacent = objectAdjacent(registry, collection, selection);
      } else if (Object.hasOwn(registry[collection]!.relationships, name)) {
        const relation = registry[collection]!.relationships[name]!;
        const nested = objectPlan(
          registry,
          relation.collection,
          selection,
          relation.type === "many",
          allowAdjacent,
        );
        if (!nested.select && !nested.adjacent) {
          invalidQuery("Related entries require explicit selection.");
        }
        related[name] = nested;
      } else {
        if (selection !== true) {
          invalidQuery("Prepared fields must be selected with true.");
        }
        fields.push(name);
      }
    }
    plan = { ...plan, select: checkedFields(registry, collection, fields), with: related };
  }
  return plan;
}
