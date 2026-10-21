import { invalidQuery } from "../shared/errors.ts";
import { detach } from "../shared/values.ts";
import { validateExpression } from "./operators.ts";
import { checkedFields, checkedOrder, checkedPagination } from "./clauses.ts";
import { objectPlan } from "./object.ts";
import {
  emptyPlan,
  hasSelection,
  type Expression,
  type QueryPlan,
  type QueryRegistry,
  type QueryRunner,
} from "./plan.ts";

const planSymbol = Symbol("content-query.query-plan");
const scopeSymbol = Symbol("content-query.query-scope");

/** Creates immutable root or relationship builders over one backend-independent plan. */
export function createBuilder(
  registry: QueryRegistry,
  run: QueryRunner,
  plan: QueryPlan,
  many = true,
  root = true,
  scopeToken: object = {},
  allowAdjacent = true,
  allowPagination = true,
): unknown {
  const scope = registry[plan.collection];
  if (!scope) {
    invalidQuery(`Unknown collection "${plan.collection}".`);
  }
  const branch = (next: Partial<QueryPlan>) =>
    createBuilder(
      registry,
      run,
      { ...plan, ...next },
      many,
      root,
      scopeToken,
      allowAdjacent,
      allowPagination,
    );
  const builder = {
    [planSymbol]: plan,
    [scopeSymbol]: scopeToken,
    select(...fields: string[]) {
      if (plan.select || fields.length === 0) {
        invalidQuery(
          "select() requires distinct prepared fields and can be called once per scope.",
        );
      }
      return branch({
        select: checkedFields(registry, plan.collection, fields),
        allFields: undefined,
        exclude: undefined,
      });
    },
    where(configure: (fields: object) => Expression) {
      if (typeof configure !== "function") {
        invalidQuery("where() requires a configuration callback.");
      }
      const expression = configure(
        new Proxy(Object.create(null) as object, { get: (_target, name) => ({ name }) }),
      );
      validateExpression(expression);
      return branch({ filters: [...plan.filters, detach(expression)] });
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      return branch({ order: checkedOrder(plan, field, direction, many) });
    },
    limit(value: number) {
      return pagination("limit", value);
    },
    offset(value: number) {
      return pagination("offset", value);
    },
    with(name: string, configure: (query: unknown) => unknown) {
      const relation = Object.hasOwn(scope.relationships, name)
        ? scope.relationships[name]
        : undefined;
      if (!relation || Object.hasOwn(plan.with, name) || typeof configure !== "function") {
        invalidQuery("Unknown, repeated, or invalid relationship request.");
      }
      const nestedScope = {};
      const configured = configure(
        createBuilder(
          registry,
          run,
          emptyPlan(relation.collection),
          relation.type === "many",
          false,
          nestedScope,
          allowAdjacent,
        ),
      );
      const nested =
        configured && typeof configured === "object" && planSymbol in configured
          ? (configured[planSymbol] as QueryPlan)
          : undefined;
      if (
        !hasSelection(nested) ||
        nested.collection !== relation.collection ||
        !(scopeSymbol in (configured as object)) ||
        (configured as { [scopeSymbol]: object })[scopeSymbol] !== nestedScope
      ) {
        invalidQuery(
          "Each relationship callback must return its explicitly selected scoped builder.",
        );
      }
      return branch({ with: { ...plan.with, [name]: nested } });
    },
    selectAdjacent(configure?: object | ((siblings: unknown) => unknown)) {
      if (!allowAdjacent || plan.adjacent !== undefined) {
        invalidQuery("Adjacency cannot be repeated or selected recursively.");
      }
      if (configure === undefined) {
        return branch({ adjacent: true });
      }
      if (typeof configure !== "function") {
        const adjacent = objectPlan(registry, plan.collection, configure, true, false, false);
        if (!adjacent.select) {
          invalidQuery("Adjacent entries require explicit selection.");
        }
        return branch({ adjacent });
      }
      const nestedScope = {};
      const configured = configure(
        createBuilder(
          registry,
          run,
          emptyPlan(plan.collection),
          true,
          false,
          nestedScope,
          false,
          false,
        ),
      );
      const adjacent =
        configured && typeof configured === "object" && planSymbol in configured
          ? (configured[planSymbol] as QueryPlan)
          : undefined;
      if (
        !hasSelection(adjacent) ||
        !(scopeSymbol in (configured as object)) ||
        (configured as { [scopeSymbol]: object })[scopeSymbol] !== nestedScope
      ) {
        invalidQuery("selectAdjacent() must return its explicitly selected sibling query.");
      }
      return branch({ adjacent });
    },
    all() {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      return run(plan, "all");
    },
    /** Executes a selected root query, matching direct await behavior. */
    execute() {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      return run(plan, "all");
    },
    first() {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      return run(plan, "first");
    },
    count() {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      return run(plan, "count");
    },
  };
  if (root && hasSelection(plan)) {
    // oxlint-disable-next-line unicorn/no-thenable -- Fluent queries intentionally execute when awaited.
    Object.defineProperty(builder, "then", {
      value: (
        fulfilled: Parameters<Promise<unknown>["then"]>[0],
        rejected: Parameters<Promise<unknown>["then"]>[1],
      ) => run(plan, "all").then(fulfilled, rejected),
    });
  }
  /** Checks pagination before creating an independent branch. */
  function pagination(key: "limit" | "offset", value: number): unknown {
    if (!allowPagination || plan[key] !== undefined) {
      invalidQuery(
        "Pagination requires a nonnegative safe integer, one call per clause, and a many-valued scope.",
      );
    }
    return branch({ [key]: checkedPagination(value, many) });
  }
  return builder;
}
