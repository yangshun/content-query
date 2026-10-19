import { invalidQuery } from "../shared/errors.ts";
import { detach, isScalar } from "../shared/values.ts";
import type { Expression, PredicateOperator } from "./plan.ts";
import type { Field, Ordered, Scalar, ScalarField } from "./types.ts";

/** Builds a checked, backend-independent predicate instead of a per-entry callback. */
function predicate(
  operator: PredicateOperator,
  field: { name: string },
  value?: unknown,
): Expression {
  if (!field || typeof field.name !== "string" || !field.name) {
    invalidQuery("A filter must reference a query field.");
  }
  if (["in-array", "not-in-array", "array-contains-any", "array-contains-all"].includes(operator)) {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      invalidQuery("Choice arguments must be arrays of scalar values.");
    }
  } else if (["contains", "starts-with", "ends-with"].includes(operator)) {
    if (typeof value !== "string") {
      invalidQuery("String predicates require a string argument.");
    }
  } else if (!operator.startsWith("is-") && !isScalar(value)) {
    invalidQuery("This predicate requires a scalar argument.");
  }
  if (
    ["gt", "gte", "lt", "lte"].includes(operator) &&
    (value == null || typeof value === "boolean")
  ) {
    invalidQuery("Range predicates require a string, number, bigint, or date.");
  }
  return { kind: "predicate", operator, field: field.name, value: detach(value) };
}
/** Matches a scalar using strict value/date equality. */
export function eq<Value>(field: ScalarField<Value>, value: NoInfer<Value>): Expression {
  return predicate("eq", field, value);
}
/** Negates scalar equality. */
export function ne<Value>(field: ScalarField<Value>, value: NoInfer<Value>): Expression {
  return predicate("ne", field, value);
}
/** Matches values greater than the supplied scalar. */
export function gt<Value>(
  field: Field<Value> & Ordered<Value>,
  value: NoInfer<NonNullable<Value>>,
): Expression {
  return predicate("gt", field, value);
}
/** Matches values greater than or equal to the supplied scalar. */
export function gte<Value>(
  field: Field<Value> & Ordered<Value>,
  value: NoInfer<NonNullable<Value>>,
): Expression {
  return predicate("gte", field, value);
}
/** Matches values less than the supplied scalar. */
export function lt<Value>(
  field: Field<Value> & Ordered<Value>,
  value: NoInfer<NonNullable<Value>>,
): Expression {
  return predicate("lt", field, value);
}
/** Matches values less than or equal to the supplied scalar. */
export function lte<Value>(
  field: Field<Value> & Ordered<Value>,
  value: NoInfer<NonNullable<Value>>,
): Expression {
  return predicate("lte", field, value);
}
/** Matches one of a list of scalar choices. */
export function inArray<Value>(
  field: ScalarField<Value>,
  values: readonly NoInfer<Value>[],
): Expression {
  return predicate("in-array", field, values);
}
/** Matches none of a list of scalar choices. */
export function notInArray<Value>(
  field: ScalarField<Value>,
  values: readonly NoInfer<Value>[],
): Expression {
  return predicate("not-in-array", field, values);
}
/** Matches a literal substring, without SQL wildcard interpretation. */
export function contains<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  value: string,
): Expression {
  return predicate("contains", field, value);
}
/** Matches a literal string prefix. */
export function startsWith<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  value: string,
): Expression {
  return predicate("starts-with", field, value);
}
/** Matches a literal string suffix. */
export function endsWith<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  value: string,
): Expression {
  return predicate("ends-with", field, value);
}
/** Tests scalar membership in an array, ignoring holes. */
export function arrayContains<Value extends Scalar>(
  field: Field<readonly Value[] | null | undefined>,
  value: NoInfer<Value>,
): Expression {
  return predicate("array-contains", field, value);
}
/** Tests whether any candidate belongs to an existing scalar array. */
export function arrayContainsAny<Value extends Scalar>(
  field: Field<readonly Value[] | null | undefined>,
  values: readonly NoInfer<Value>[],
): Expression {
  return predicate("array-contains-any", field, values);
}
/** Tests whether every candidate belongs to an existing scalar array. */
export function arrayContainsAll<Value extends Scalar>(
  field: Field<readonly Value[] | null | undefined>,
  values: readonly NoInfer<Value>[],
): Expression {
  return predicate("array-contains-all", field, values);
}
/** Checks explicit null independently from undefined and absence. */
export function isNull<Value>(field: Field<Value>): Expression {
  return predicate("is-null", field);
}
/** Checks undefined, including a missing property. */
export function isUndefined<Value>(field: Field<Value>): Expression {
  return predicate("is-undefined", field);
}
/** Checks own-property absence before projection. */
export function isMissing<Value>(field: Field<Value>): Expression {
  return predicate("is-missing", field);
}
/** Requires all child predicates; an empty conjunction is true. */
export function and(...expressions: Expression[]): Expression {
  expressions.forEach(validateExpression);
  return { kind: "and", expressions };
}
/** Requires any child predicate; an empty disjunction is false. */
export function or(...expressions: Expression[]): Expression {
  expressions.forEach(validateExpression);
  return { kind: "or", expressions };
}
/** Negates a predicate's boolean result. */
export function not(expression: Expression): Expression {
  validateExpression(expression);
  return { kind: "not", expressions: [expression] };
}

/** Checks the shape of expression trees even when TypeScript was bypassed. */
export function validateExpression(expression: Expression): void {
  if (!expression || typeof expression !== "object") {
    invalidQuery("where() must return a structured expression.");
  }
  if (expression.kind === "predicate") {
    const allowed = [
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte",
      "in-array",
      "not-in-array",
      "contains",
      "starts-with",
      "ends-with",
      "array-contains",
      "array-contains-any",
      "array-contains-all",
      "is-null",
      "is-undefined",
      "is-missing",
    ];
    if (!allowed.includes(expression.operator)) {
      invalidQuery("Unknown filter operator.");
    }
    predicate(expression.operator, { name: expression.field }, expression.value);
  } else if (
    ["and", "or", "not"].includes(expression.kind) &&
    Array.isArray(expression.expressions)
  ) {
    if (expression.kind === "not" && expression.expressions.length !== 1) {
      invalidQuery("not() requires one expression.");
    }
    expression.expressions.forEach(validateExpression);
  } else {
    invalidQuery("Invalid expression structure.");
  }
}
