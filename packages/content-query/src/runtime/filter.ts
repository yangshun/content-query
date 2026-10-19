import { compare, equal } from "../shared/values.ts";
import type { Expression } from "../query/plan.ts";

/** Evaluates the portable expression tree using the agreed scalar semantics. */
export function matches(record: Record<string, unknown>, expression: Expression): boolean {
  if (expression.kind === "and") {
    return expression.expressions.every((child) => matches(record, child));
  }
  if (expression.kind === "or") {
    return expression.expressions.some((child) => matches(record, child));
  }
  if (expression.kind === "not") {
    return !matches(record, expression.expressions[0]!);
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
