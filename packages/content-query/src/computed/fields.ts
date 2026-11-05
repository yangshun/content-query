import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ComputedContext } from "../collection/types.ts";
import type { MaybePromise } from "../shared/types.ts";
import { assertServerOnly } from "../shared/server-only.ts";

assertServerOnly();

/** Result schemas for computed fields that one resolver call fills, keyed by field name. */
export type ComputedFieldSchemas = Record<string, StandardSchemaV1>;

/**
 * The object a shared resolver returns: one value per field, checked by that field's schema.
 * Fields whose schema accepts `undefined` may be omitted.
 */
export type ComputedFieldValues<Fields extends ComputedFieldSchemas> = {
  [
    Key in keyof Fields as undefined extends StandardSchemaV1.InferInput<Fields[Key]> ? never : Key
  ]: StandardSchemaV1.InferInput<Fields[Key]>;
} & {
  [
    Key in keyof Fields as undefined extends StandardSchemaV1.InferInput<Fields[Key]> ? Key : never
  ]?: StandardSchemaV1.InferInput<Fields[Key]>;
};

/** Declares several computed fields and the one resolver that returns all of their values. */
export type ComputedFieldsOptions<
  Fields extends ComputedFieldSchemas,
  Data = Record<string, unknown>,
  Source = unknown,
> = {
  /**
   * Each field's result schema, keyed by field name. A JSDoc comment on a key documents that
   * field in entry types and query results.
   */
  fields: Fields;
  /**
   * Returns every field's value for one entry. It runs once per entry each time the entry is
   * prepared, however many fields it fills; files it reads through `files` are tracked as usual.
   * Annotate the context, such as `(context: ComputedContext<Post>)`, to type `data`.
   */
  resolve(
    this: void,
    context: ComputedContext<Data, Source>,
  ): MaybePromise<ComputedFieldValues<Fields>>;
};

/** The computed field definitions that {@link computedFields} returns, one per declared field. */
export type ComputedFieldDefinitions<
  Fields extends ComputedFieldSchemas,
  Data = Record<string, unknown>,
  Source = unknown,
> = {
  [Key in keyof Fields]: {
    schema: Fields[Key];
    resolve(context: ComputedContext<Data, Source>): Promise<unknown>;
  };
};

/**
 * Creates computed fields that share one resolver call per entry, for values that come from the
 * same expensive read, such as several properties of one JSON file beside the entry. Spread the
 * result into `computed`; each field is validated by its own schema and is selected, filtered, and
 * sorted like any other computed field.
 *
 * @example
 * ```ts
 * computed: {
 *   ...computedFields({
 *     fields: { title: schema.string(), description: schema.string() },
 *     resolve: async ({ files }) => JSON.parse(await files.text("info/en-US.json")),
 *   }),
 * }
 * ```
 *
 * @param options - The fields' result schemas and the resolver that returns their values.
 * @returns One computed field definition per key of `options.fields`.
 * @throws TypeError - When `fields` declares no schemas or `resolve` is not a function.
 */
export function computedFields<
  const Fields extends ComputedFieldSchemas,
  Data = Record<string, unknown>,
  Source = unknown,
>(
  options: ComputedFieldsOptions<Fields, Data, Source>,
): ComputedFieldDefinitions<Fields, Data, Source> {
  const { fields, resolve } = options ?? {};
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("computedFields() fields must be an object of result schemas.");
  }
  const entries = Object.entries(fields);
  if (!entries.length || entries.some(([, schema]) => !isSchema(schema))) {
    throw new TypeError(
      "computedFields() fields must declare at least one field, each with a Standard Schema.",
    );
  }
  if (typeof resolve !== "function") {
    throw new TypeError("computedFields() resolve must be a function.");
  }
  // Preparation gives every computed field of one entry the same `files` helpers, and creates new
  // ones for each preparation, so they identify one entry's resolution without outliving it.
  const resolutions = new WeakMap<object, Promise<Record<string, unknown>>>();
  /** Resolves every field's value once for the entry being prepared. */
  function values(context: ComputedContext<Data, Source>): Promise<Record<string, unknown>> {
    let pending = resolutions.get(context.files);
    if (!pending) {
      pending = (async () => {
        context.signal.throwIfAborted();
        const result: unknown = await resolve(context);
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new TypeError(
            "computedFields() resolve must return an object with a value for each field.",
          );
        }
        return result as Record<string, unknown>;
      })();
      resolutions.set(context.files, pending);
    }
    return pending;
  }
  return Object.fromEntries(
    entries.map(([name, schema]) => [
      name,
      {
        schema,
        /** Reads this field's value from the entry's shared resolution. */
        async resolve(context: ComputedContext<Data, Source>) {
          const result = await values(context);
          return Object.hasOwn(result, name) ? result[name] : undefined;
        },
      },
    ]),
  ) as ComputedFieldDefinitions<Fields, Data, Source>;
}

/** Checks for a Standard Schema V1 validator. */
function isSchema(value: unknown): value is StandardSchemaV1 {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "~standard" in value
  );
}
