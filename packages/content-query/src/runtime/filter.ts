import { compare, equal } from "../shared/values.ts";
import type { Expression } from "../query/plan.ts";
import { invalidQuery } from "../shared/errors.ts";
import { relationKey } from "./relationships.ts";
import type { PreparedRevision } from "./revision.ts";

/** Matches SQL-style percent/underscore patterns without adopting database collation rules. */
function matchesPattern(actual: unknown, pattern: string, insensitive: boolean): boolean {
  if (typeof actual !== "string") {
    return false;
  }
  let source = "";
  let escaped = false;
  for (const character of pattern) {
    if (!escaped && character === "\\") {
      escaped = true;
      continue;
    }
    source +=
      !escaped && character === "%"
        ? ".*"
        : !escaped && character === "_"
          ? "."
          : character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    escaped = false;
  }
  if (escaped) {
    source += "\\\\";
  }
  return new RegExp(`^${source}$`, insensitive ? "isu" : "su").exec(actual)?.[0] === actual;
}

/** Evaluates the portable expression tree using the agreed scalar semantics. */
export function matches(
  record: Record<string, unknown>,
  expression: Expression,
  revision?: PreparedRevision,
  collection?: string,
): boolean {
  if (expression.kind === "and") {
    return expression.expressions.every((child) => matches(record, child, revision, collection));
  }
  if (expression.kind === "or") {
    return expression.expressions.some((child) => matches(record, child, revision, collection));
  }
  if (expression.kind === "not") {
    return !matches(record, expression.expressions[0]!, revision, collection);
  }
  if (expression.kind === "relation") {
    const relation =
      revision &&
      collection === expression.collection &&
      revision.registry[collection]?.relationships[expression.field];
    if (!revision || !relation || relation.collection !== expression.target) {
      invalidQuery("Relationship filter no longer matches the prepared collection scope.");
    }
    const candidates =
      revision.relations
        .get(relationKey(expression.collection, expression.field))
        ?.get(record.id as string) ?? [];
    return candidates.some((candidate) =>
      matches(candidate, expression.expression, revision, expression.target),
    );
  }
  if (expression.kind !== "predicate") {
    return false;
  }
  const actual = Object.hasOwn(record, expression.field) ? record[expression.field] : undefined;
  const expected = expression.value;
  switch (expression.operator) {
    case "eq":
      return equal(actual, expected);
    case "ne":
      return !equal(actual, expected);
    case "is-null":
      return actual === null;
    case "is-undefined":
      return actual === undefined;
    case "is-missing":
      return !Object.hasOwn(record, expression.field);
    case "in-array":
      return (expected as unknown[]).some((candidate) => equal(actual, candidate));
    case "not-in-array":
      return !(expected as unknown[]).some((candidate) => equal(actual, candidate));
    case "contains":
      return typeof actual === "string" && actual.includes(expected as string);
    case "starts-with":
      return typeof actual === "string" && actual.startsWith(expected as string);
    case "ends-with":
      return typeof actual === "string" && actual.endsWith(expected as string);
    case "like":
    case "ilike":
      return matchesPattern(actual, expected as string, expression.operator === "ilike");
    case "array-contains":
      return Array.isArray(actual) && actual.some((candidate) => equal(candidate, expected));
    case "array-contains-any":
      return (
        Array.isArray(actual) &&
        (expected as unknown[]).some((candidate) => actual.some((item) => equal(item, candidate)))
      );
    case "array-contains-all":
      return (
        Array.isArray(actual) &&
        (expected as unknown[]).every((candidate) => actual.some((item) => equal(item, candidate)))
      );
    case "array-contained":
      return (
        Array.isArray(actual) &&
        actual.every((candidate) => (expected as unknown[]).some((item) => equal(candidate, item)))
      );
    default: {
      const order = compare(actual, expected);
      if (order === undefined) {
        return false;
      }
      return expression.operator === "gt"
        ? order > 0
        : expression.operator === "gte"
          ? order >= 0
          : expression.operator === "lt"
            ? order < 0
            : order <= 0;
    }
  }
}
