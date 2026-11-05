import { invalidQuery } from "../shared/errors.ts";
import { detach, isScalar } from "../shared/values.ts";
import {
  assertAvailable,
  type Expression,
  type PredicateOperator,
  type QueryRegistry,
} from "./plan.ts";
import type { Field, Ordered, RelationField, Scalar, ScalarField } from "./types.ts";

/** Builds a checked, backend-independent predicate instead of a per-entry callback. */
function predicate(
  operator: PredicateOperator,
  field: { name: string },
  value?: unknown,
): Expression {
  if (!field || typeof field.name !== "string" || !field.name) {
    invalidQuery("A filter must reference a query field.");
  }
  if (
    [
      "in-array",
      "not-in-array",
      "array-contains-any",
      "array-contains-all",
      "array-contained",
    ].includes(operator)
  ) {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      invalidQuery("Choice arguments must be arrays of scalar values.");
    }
  } else if (["contains", "starts-with", "ends-with", "like", "ilike"].includes(operator)) {
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
/**
 * Matches a SQL-style pattern: `%` matches any run of characters and `_` matches one character.
 * A backslash escapes a wildcard. Matching is case-sensitive.
 */
export function like<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  pattern: string,
): Expression {
  return predicate("like", field, pattern);
}
/** Matches a SQL-style pattern like {@link like}, ignoring case. */
export function ilike<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  pattern: string,
): Expression {
  return predicate("ilike", field, pattern);
}
/** Negates {@link like}; entries without a matching string, including absent values, match. */
export function notLike<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  pattern: string,
): Expression {
  return not(like(field, pattern));
}
/** Negates {@link ilike}; entries without a matching string, including absent values, match. */
export function notIlike<Value>(
  field: Field<Value> & (NonNullable<Value> extends string ? unknown : never),
  pattern: string,
): Expression {
  return not(ilike(field, pattern));
}
/** Tests whether every item of an existing scalar array belongs to the candidates. */
export function arrayContained<Value extends Scalar>(
  field: Field<readonly Value[] | null | undefined>,
  values: readonly NoInfer<Value>[],
): Expression {
  return predicate("array-contained", field, values);
}
/**
 * Matches entries with at least one related entry. With a filter, a related entry must also match
 * it, for example `has(fields.author, (author) => eq(author.name, "Ada"))`. Wrap the result in
 * {@link not} to match entries without such a related entry.
 *
 * @param relation - A relationship from the `where()` callback's fields.
 * @param filter - Optional filter over the related entry's fields and relationships.
 * @returns An expression that the query resolves against the relationship's target collection.
 */
export function has<TargetFields>(
  relation: RelationField<TargetFields>,
  filter?: (fields: TargetFields) => Expression,
): Expression {
  if (!relation || typeof relation.name !== "string" || !relation.name) {
    invalidQuery("has() requires a relationship from the where() fields.");
  }
  if (filter !== undefined && typeof filter !== "function") {
    invalidQuery("has() filters must be callbacks over the related entry's fields.");
  }
  const expression = filter === undefined ? and() : filter(fieldProxy() as TargetFields);
  validateExpression(expression);
  return { kind: "has", field: relation.name, expression };
}
/** Creates the field and relationship accessors passed to filter callbacks. */
export function fieldProxy(): object {
  return new Proxy(Object.create(null) as object, { get: (_target, name) => ({ name }) });
}
/**
 * Resolves fluent `has()` filters against a scope's declared relationships, producing portable
 * `relation` expressions that both runtime backends evaluate.
 *
 * @param registry - The query registry with each collection's relationships.
 * @param collection - The collection the expression filters.
 * @param expression - A validated expression that may contain `has()` filters.
 * @returns The expression with every `has()` filter resolved.
 */
export function resolveRelations(
  registry: QueryRegistry,
  collection: string,
  expression: Expression,
): Expression {
  switch (expression.kind) {
    case "has": {
      const relationships = registry[collection]?.relationships ?? {};
      const relation = Object.hasOwn(relationships, expression.field)
        ? relationships[expression.field]
        : undefined;
      if (!relation) {
        assertAvailable(registry, collection, expression.field);
        invalidQuery(`Unknown relationship "${expression.field}" in has().`);
      }
      return {
        kind: "relation",
        collection,
        field: expression.field,
        target: relation.collection,
        expression: resolveRelations(registry, relation.collection, expression.expression),
      };
    }
    case "relation":
      return {
        ...expression,
        expression: resolveRelations(registry, expression.target, expression.expression),
      };
    case "and":
    case "or":
    case "not":
      return {
        ...expression,
        expressions: expression.expressions.map((child) =>
          resolveRelations(registry, collection, child),
        ),
      };
    default:
      return expression;
  }
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
      "like",
      "ilike",
      "array-contains",
      "array-contains-any",
      "array-contains-all",
      "array-contained",
      "is-null",
      "is-undefined",
      "is-missing",
    ];
    if (!allowed.includes(expression.operator)) {
      invalidQuery("Unknown filter operator.");
    }
    predicate(expression.operator, { name: expression.field }, expression.value);
  } else if (expression.kind === "relation") {
    if (
      [expression.collection, expression.field, expression.target].some(
        (name) => typeof name !== "string" || !name,
      )
    ) {
      invalidQuery("Relationship filters require registered collection and relationship names.");
    }
    validateExpression(expression.expression);
  } else if (expression.kind === "has") {
    if (typeof expression.field !== "string" || !expression.field) {
      invalidQuery("has() requires a relationship from the where() fields.");
    }
    validateExpression(expression.expression);
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
