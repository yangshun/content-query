import { invalidQuery } from "../shared/errors.ts";
import { detach, isScalar } from "../shared/values.ts";
import { and, fieldProxy, not, or, resolveRelations, validateExpression } from "./operators.ts";
import { checkedFields, checkedOrder, checkedPagination, checkedPayloads } from "./clauses.ts";
import {
  emptyPlan,
  hasSelection,
  NO_SELECTION_MESSAGE,
  type AdjacentPlan,
  type Expression,
  type PredicateOperator,
  type QueryPlan,
  type QueryRegistry,
  type QueryRunner,
} from "./plan.ts";

const operators: Record<string, PredicateOperator> = {
  eq: "eq",
  ne: "ne",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  in: "in-array",
  notIn: "not-in-array",
  like: "like",
  ilike: "ilike",
  notLike: "like",
  notIlike: "ilike",
  contains: "contains",
  startsWith: "starts-with",
  endsWith: "ends-with",
  arrayContains: "array-contains-all",
  arrayOverlaps: "array-contains-any",
  arrayContained: "array-contained",
  isNull: "is-null",
  isNotNull: "is-null",
  isUndefined: "is-undefined",
  isMissing: "is-missing",
};

/** Requires plain records at each relational options and filter boundary. */
function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    invalidQuery(`${label} must be an options object.`);
  }
}

/** Compiles a field condition, including field-local boolean composition, into portable expressions. */
function fieldCondition(field: string, condition: unknown): Expression {
  if (isScalar(condition)) {
    return { kind: "predicate", operator: "eq", field, value: condition };
  }
  record(condition, `Filter for "${field}"`);
  const expressions: Expression[] = [];
  for (const [name, value] of Object.entries(condition)) {
    if (name === "AND" || name === "OR") {
      if (!Array.isArray(value)) {
        invalidQuery("Field AND/OR filters require arrays.");
      }
      const children = value.map((child: unknown) => fieldCondition(field, child));
      expressions.push(name === "AND" ? and(...children) : or(...children));
      continue;
    }
    if (name === "NOT") {
      expressions.push(not(fieldCondition(field, value)));
      continue;
    }
    if (!Object.hasOwn(operators, name)) {
      invalidQuery(`Unknown filter operator "${name}".`);
    }
    const expression: Expression = { kind: "predicate", operator: operators[name]!, field, value };
    if (name.startsWith("is")) {
      if (typeof value !== "boolean") {
        invalidQuery("Presence predicates require boolean values.");
      }
      expressions.push(value !== (name === "isNotNull") ? expression : not(expression));
    } else {
      expressions.push(name === "notLike" || name === "notIlike" ? not(expression) : expression);
    }
  }
  return and(...expressions);
}

/** Compiles object predicates and existential relationship filters without loading bodies. */
export function relationalWhere(
  registry: QueryRegistry,
  collection: string,
  where: unknown,
): Expression {
  record(where, "where");
  const expressions: Expression[] = [];
  for (const [field, condition] of Object.entries(where)) {
    if (field === "AND" || field === "OR" || field === "NOT") {
      if (field === "OR" && !Array.isArray(condition)) {
        invalidQuery("OR filters require an array.");
      }
      const children = (Array.isArray(condition) ? condition : [condition]).map((child: unknown) =>
        relationalWhere(registry, collection, child),
      );
      expressions.push(
        field === "OR"
          ? or(...children)
          : field === "NOT"
            ? and(...children.map(not))
            : and(...children),
      );
    } else if (field === "RAW") {
      if (typeof condition !== "function") {
        invalidQuery("RAW requires a structured-expression callback.");
      }
      const expression = condition(fieldProxy()) as Expression;
      validateExpression(expression);
      expressions.push(resolveRelations(registry, collection, expression));
    } else if (Object.hasOwn(registry[collection]!.relationships, field)) {
      const relation = registry[collection]!.relationships[field]!;
      const expression: Expression = {
        kind: "relation",
        collection,
        field,
        target: relation.collection,
        expression: relationalWhere(
          registry,
          relation.collection,
          typeof condition === "boolean" ? {} : condition,
        ),
      };
      expressions.push(condition === false ? not(expression) : expression);
    } else {
      expressions.push(fieldCondition(field, condition));
    }
  }
  const expression = and(...expressions);
  validateExpression(expression);
  return detach(expression);
}

/**
 * Compiles Drizzle-style columns/with options into the shared immutable query plan.
 * Payloads are allowed wherever adjacency is, so sibling scopes never load them.
 */
export function relationalPlan(
  registry: QueryRegistry,
  collection: string,
  options: unknown = {},
  many = true,
  allowAdjacent = true,
  pagination = true,
): QueryPlan {
  if (!Object.hasOwn(registry, collection)) {
    invalidQuery(`Unknown collection "${collection}".`);
  }
  record(options, "Query");
  const allowed = [
    "columns",
    "where",
    "with",
    ...(many ? ["orderBy"] : []),
    ...(many && pagination ? ["limit", "offset"] : []),
    ...(allowAdjacent ? ["adjacent", "payloads"] : []),
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    invalidQuery("Unknown relational query option or unsupported scope option.");
  }
  const plan = emptyPlan(collection);
  if (options.where !== undefined) {
    plan.filters = [relationalWhere(registry, collection, options.where)];
  }
  // Omitted columns select no fields; nothing is implicit, not even `id`.
  if (options.columns !== undefined) {
    record(options.columns, "columns");
    const columns = options.columns;
    if (Object.values(columns).some((value) => value !== true)) {
      invalidQuery("Columns list the fields to include with `true`; omit fields you do not need.");
    }
    plan.select = checkedFields(registry, collection, Object.keys(columns));
  }
  if (options.with !== undefined) {
    record(options.with, "with");
    const related: Record<string, QueryPlan> = Object.create(null) as Record<string, QueryPlan>;
    for (const [name, selected] of Object.entries(options.with)) {
      const relation =
        Object.hasOwn(registry[collection]!.relationships, name) &&
        registry[collection]!.relationships[name];
      if (!relation) {
        invalidQuery(`Unknown relationship "${name}".`);
      }
      if (selected === false || selected === undefined) {
        continue;
      }
      if (selected === true) {
        invalidQuery(
          `Relationship "${name}" requires nested options that select data, such as { columns: { id: true } }.`,
        );
      }
      related[name] = selectedPlan(
        relationalPlan(
          registry,
          relation.collection,
          selected,
          relation.type === "many",
          allowAdjacent,
        ),
      );
    }
    plan.with = related;
  }
  if (options.orderBy !== undefined) {
    record(options.orderBy, "orderBy");
    if (!Object.keys(options.orderBy).length) {
      invalidQuery("orderBy requires a field.");
    }
    for (const [field, direction] of Object.entries(options.orderBy)) {
      plan.order = checkedOrder(plan, field, direction as "asc" | "desc", many);
    }
  }
  for (const key of ["limit", "offset"] as const) {
    if (options[key] !== undefined) {
      plan[key] = checkedPagination(options[key] as number, many);
    }
  }
  if (options.payloads !== undefined) {
    record(options.payloads, "payloads");
    const payloads = checkedPayloads(registry, collection, options.payloads);
    if (payloads) {
      plan.payloads = payloads;
    }
  }
  if (options.adjacent !== undefined) {
    plan.adjacent = relationalAdjacent(registry, collection, options.adjacent);
  }
  return plan;
}

/**
 * Compiles relational `adjacent` options. `{ scope: "results", columns, with }` selects neighbors
 * within the current results; other options describe an independent sibling scope.
 *
 * @param registry - The query registry.
 * @param collection - The collection whose neighbors are selected.
 * @param adjacent - The `adjacent` option value.
 * @returns The adjacency plan, which always selects explicit data.
 */
function relationalAdjacent(
  registry: QueryRegistry,
  collection: string,
  adjacent: unknown,
): AdjacentPlan {
  if (adjacent === true) {
    invalidQuery(
      'Adjacent entries select their own data, such as { scope: "results", columns: { id: true } }.',
    );
  }
  record(adjacent, "adjacent");
  const { scope, ...options } = adjacent;
  if (scope !== undefined && scope !== "results" && scope !== "collection") {
    invalidQuery('Adjacent scope must be "results" or "collection".');
  }
  if (
    scope === "results" &&
    Object.keys(options).some((key) => key !== "columns" && key !== "with")
  ) {
    invalidQuery(
      "Results-scope neighbors only select data; they share the query's filters and order.",
    );
  }
  return {
    scope: scope === "results" ? "results" : "collection",
    plan: selectedPlan(relationalPlan(registry, collection, options, true, false, false)),
  };
}

/**
 * Rejects a row-returning scope that requests no data.
 *
 * @param plan - A root, relationship, or sibling scope.
 * @returns The same plan when it selects fields, relationships, payloads, or adjacency.
 */
export function selectedPlan(plan: QueryPlan): QueryPlan {
  if (!hasSelection(plan)) {
    invalidQuery(NO_SELECTION_MESSAGE);
  }
  return plan;
}

/** Creates stable, live collection queries in a dedicated, prototype-free namespace. */
export function createQueryNamespace(registry: () => QueryRegistry, run: QueryRunner): object {
  const queries = new Map<string, object>();
  /** Reuses each handle while checking the current registry on every query execution. */
  function query(name: string): object {
    let cached = queries.get(name);
    if (!cached) {
      cached = {
        findMany: (options?: unknown) =>
          run(selectedPlan(relationalPlan(registry(), name, options)), "all"),
        findFirst: (options?: unknown) =>
          run(selectedPlan(relationalPlan(registry(), name, options)), "first"),
      };
      queries.set(name, cached);
    }
    return cached;
  }
  return new Proxy(Object.create(null) as object, {
    get(_target, name) {
      return typeof name === "string" && Object.hasOwn(registry(), name) ? query(name) : undefined;
    },
    ownKeys() {
      return Object.keys(registry());
    },
    getOwnPropertyDescriptor(_target, name) {
      return typeof name === "string" && Object.hasOwn(registry(), name)
        ? { configurable: true, enumerable: true, value: query(name), writable: false }
        : undefined;
    },
  });
}
