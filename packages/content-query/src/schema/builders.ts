import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Content-oriented Zod builders; returned schemas retain their validation and chaining methods. */
export {
  object,
  string,
  number,
  boolean,
  bigint,
  date,
  array,
  enum,
  literal,
  union,
  record,
  unknown,
  coerce,
} from "zod";

/** Infers the input type of any Standard Schema V1 validator. */
export type input<Validator extends StandardSchemaV1> = StandardSchemaV1.InferInput<Validator>;

/** Infers the validated output type of any Standard Schema V1 validator. */
export type output<Validator extends StandardSchemaV1> = StandardSchemaV1.InferOutput<Validator>;

/** Infers validated output, including defaults and transforms, from any Standard Schema V1 validator. */
export type { output as infer };
