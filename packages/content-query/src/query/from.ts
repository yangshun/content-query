import { invalidQuery } from "../shared/errors.ts";
import { createBuilder } from "./builder.ts";
import { emptyPlan, type QueryRegistry, type QueryRunner } from "./plan.ts";

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
  const current = registry();
  if (typeof collection !== "string" || !Object.hasOwn(current, collection)) {
    invalidQuery(`Unknown collection "${String(collection)}".`);
  }
  return createBuilder(current, run, emptyPlan(collection));
}
