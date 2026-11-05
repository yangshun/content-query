import { invalidQuery } from "../shared/errors.ts";
import { createBuilder } from "./builder.ts";
import { emptyPlan, type Expression, type QueryRegistry, type QueryRunner } from "./plan.ts";

/**
 * Starts a fluent root query over one collection. The builder selects nothing until `select()`,
 * `with()`, `withPayload()`, or `selectAdjacent()` requests data; `count()` needs no selection.
 *
 * @param registry - Reads the current query registry, so development builders bind the latest one.
 * @param run - Executes a plan against one pinned revision.
 * @param collection - The collection to query.
 * @returns An immutable, reusable root builder.
 */
export function createFrom(
  registry: () => QueryRegistry,
  run: QueryRunner,
  collection: string,
): unknown {
  return createBuilder(currentRegistry(registry, collection), run, emptyPlan(collection));
}

/**
 * Starts a fluent query for the entry with one ID. The builder returns that entry or `undefined`
 * when awaited, offers no ordering, pagination, `all()`, or results-scope adjacency, and still
 * selects nothing until the query requests data.
 *
 * @param registry - Reads the current query registry, so development builders bind the latest one.
 * @param run - Executes a plan against one pinned revision.
 * @param collection - The collection to query.
 * @param id - The entry's ID.
 * @returns An immutable, reusable single-entry root builder.
 */
export function createById(
  registry: () => QueryRegistry,
  run: QueryRunner,
  collection: string,
  id: string,
): unknown {
  const current = currentRegistry(registry, collection);
  if (typeof id !== "string") {
    invalidQuery("byId() requires an entry ID string.");
  }
  const filter: Expression = { kind: "predicate", operator: "eq", field: "id", value: id };
  return createBuilder(current, run, { ...emptyPlan(collection), filters: [filter] }, false);
}

/** Reads the registry a new root query binds, rejecting unknown collections. */
function currentRegistry(registry: () => QueryRegistry, collection: string): QueryRegistry {
  const current = registry();
  if (typeof collection !== "string" || !Object.hasOwn(current, collection)) {
    invalidQuery(`Unknown collection "${String(collection)}".`);
  }
  return current;
}
