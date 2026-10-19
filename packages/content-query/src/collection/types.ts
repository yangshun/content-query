import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Loader } from "../loaders/types.ts";

export type Schema = StandardSchemaV1;
export type SchemaOutput<Value> = Value extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Value>
  : Record<string, unknown>;
export type ComputedContext<Data> = {
  id: string;
  data: Readonly<Data>;
  readBody(this: void): Promise<string | undefined>;
  signal: AbortSignal;
};
export type ComputedDefinition<Data = Record<string, unknown>> = {
  schema: Schema;
  resolve(context: ComputedContext<Data>): unknown;
};
export type Relationship = {
  collection: string;
  type: "one" | "many";
  from: string;
  to: string;
  referenceSide: "from" | "to" | "none";
};
export type CollectionDefinition<
  SourceSchema extends Schema | undefined = Schema | undefined,
  Computed extends Record<string, ComputedDefinition<never>> = Record<
    string,
    ComputedDefinition<never>
  >,
  Relationships extends Record<string, Relationship> = Record<string, Relationship>,
> = {
  loader: Loader;
  schema?: SourceSchema;
  computed?: Computed;
  relationships?: Relationships;
};
export type CollectionRegistry = Record<string, CollectionDefinition>;
export type EntryData<Definition> = Definition extends {
  schema: infer SourceSchema;
}
  ? SchemaOutput<SourceSchema>
  : Record<string, unknown>;
export type ComputedData<Definition> = Definition extends { computed: infer Computed }
  ? {
      [Name in keyof Computed]: Computed[Name] extends { schema: infer ResultSchema }
        ? SchemaOutput<ResultSchema>
        : never;
    }
  : {};
export type QueryData<Definition> = { id: string } & EntryData<Definition> &
  ComputedData<Definition>;
export type RelationshipsOf<Definition> = Definition extends { relationships: infer Relationships }
  ? Relationships
  : {};
