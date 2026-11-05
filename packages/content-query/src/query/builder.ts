import { invalidQuery } from "../shared/errors.ts";
import { detach } from "../shared/values.ts";
import { fieldProxy, resolveRelations, validateExpression } from "./operators.ts";
import {
  checkedFields,
  checkedOrder,
  checkedPaginate,
  checkedPagination,
  checkedPayload,
} from "./clauses.ts";
import { objectPlan } from "./object.ts";
import {
  assertAvailable,
  emptyPlan,
  hasSelection,
  NO_SELECTION_MESSAGE,
  type Expression,
  type QueryPlan,
  type QueryRegistry,
  type QueryRunner,
} from "./plan.ts";

const planSymbol = Symbol("content-query.query-plan");
const scopeSymbol = Symbol("content-query.query-scope");

/**
 * Creates immutable root or relationship builders over one backend-independent plan. A root
 * builder that is not `many` is a `byId()` query, which returns one entry or `undefined`.
 */
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
    /** Selects fields, adding to earlier selections; a field selected again is kept once. */
    select(...fields: string[]) {
      if (fields.length === 0) {
        invalidQuery("select() requires at least one prepared field.");
      }
      const checked = checkedFields(registry, plan.collection, fields);
      const earlier = plan.select ?? [];
      return branch({
        select: [...earlier, ...checked.filter((field) => !earlier.includes(field))],
      });
    },
    where(configure: (fields: object) => Expression) {
      if (typeof configure !== "function") {
        invalidQuery("where() requires a configuration callback.");
      }
      const expression = configure(fieldProxy());
      validateExpression(expression);
      return branch({
        filters: [...plan.filters, detach(resolveRelations(registry, plan.collection, expression))],
      });
    },
    orderBy(field: string, direction: "asc" | "desc" = "asc") {
      assertList("orderBy()");
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
        assertAvailable(registry, plan.collection, name);
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
    withPayload(name: string, variant?: Record<string, string>) {
      if (!allowAdjacent || Object.hasOwn(plan.payloads ?? {}, name)) {
        invalidQuery("Payloads cannot be repeated or requested in adjacent scopes.");
      }
      return branch({
        payloads: {
          ...plan.payloads,
          [name]: checkedPayload(registry, plan.collection, name, variant),
        },
      });
    },
    /**
     * Selects previous and next entries. Field names select neighbors within this scope's results;
     * a callback or options object describes an independent sibling scope.
     */
    selectAdjacent(...arguments_: unknown[]) {
      if (!allowAdjacent || plan.adjacent !== undefined) {
        invalidQuery("Adjacency cannot be repeated or selected recursively.");
      }
      const [configure] = arguments_;
      if (configure === undefined || typeof configure === "string") {
        assertList("Results-scope selectAdjacent()");
        if (!arguments_.length || arguments_.some((field) => typeof field !== "string")) {
          invalidQuery(
            'selectAdjacent() requires neighbor fields, such as selectAdjacent("id"), or a sibling query.',
          );
        }
        const selection = {
          ...emptyPlan(plan.collection),
          select: checkedFields(registry, plan.collection, arguments_ as string[]),
        };
        return branch({ adjacent: { scope: "results", plan: selection } });
      }
      if (typeof configure !== "function") {
        const adjacent = objectPlan(registry, plan.collection, configure, true, false, false);
        if (!hasSelection(adjacent)) {
          invalidQuery("Adjacent entries require explicit selection.");
        }
        return branch({ adjacent: { scope: "collection", plan: adjacent } });
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
      return branch({ adjacent: { scope: "collection", plan: adjacent } });
    },
    all() {
      assertList("all()");
      return rows("all");
    },
    /** Executes a selected root query, matching direct await behavior. */
    execute() {
      return rows(many ? "all" : "first");
    },
    first() {
      return rows("first");
    },
    /** Counts matching entries; counting returns no rows, so it needs no selection. */
    count() {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      return run(plan, "count");
    },
    /**
     * Returns one page with page-number details for `{ page, size }`, or cursor details for
     * `{ size, after?, before?, total? }`, from one revision.
     */
    paginate(options: unknown) {
      if (!root) {
        invalidQuery("Nested builders have no terminal methods.");
      }
      assertList("paginate()");
      if (!hasSelection(plan)) {
        invalidQuery(NO_SELECTION_MESSAGE);
      }
      return run({ ...plan, paginate: checkedPaginate(plan, options) }, "paginate");
    },
  };
  if (root) {
    // oxlint-disable-next-line unicorn/no-thenable -- Fluent queries intentionally execute when awaited.
    Object.defineProperty(builder, "then", {
      value: (
        fulfilled: Parameters<Promise<unknown>["then"]>[0],
        rejected: Parameters<Promise<unknown>["then"]>[1],
      ) => {
        let result: Promise<unknown>;
        try {
          result = rows(many ? "all" : "first");
        } catch (cause) {
          result = Promise.reject(cause);
        }
        return result.then(fulfilled, rejected);
      },
    });
  }
  /**
   * Runs a row-returning terminal. Awaiting an unselected root rejects rather than resolving to the
   * builder, so a missing selection fails loudly in JavaScript as well as in TypeScript.
   */
  function rows(terminal: "all" | "first"): Promise<unknown> {
    if (!root) {
      invalidQuery("Nested builders have no terminal methods.");
    }
    if (!hasSelection(plan)) {
      invalidQuery(NO_SELECTION_MESSAGE);
    }
    return run(plan, terminal);
  }
  /** Rejects a list-only clause or terminal on a `byId()` query, which returns one entry. */
  function assertList(member: string): void {
    if (root && !many) {
      invalidQuery(`${member} is unavailable after byId(), which returns one entry.`);
    }
  }
  /** Checks pagination before creating an independent branch. */
  function pagination(key: "limit" | "offset", value: number): unknown {
    assertList(`${key}()`);
    if (!allowPagination || plan[key] !== undefined) {
      invalidQuery(
        "Pagination requires a nonnegative safe integer, one call per clause, and a many-valued scope.",
      );
    }
    return branch({ [key]: checkedPagination(value, many) });
  }
  return builder;
}
