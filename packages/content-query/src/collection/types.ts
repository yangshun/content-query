import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Loader } from "../loaders/types.ts";
import type { ContentRenderResult } from "../runtime/types.ts";

declare const builtinPayloadsType: unique symbol;
declare const customPayloadsType: unique symbol;

export type Schema = StandardSchemaV1;
export type SchemaOutput<Value> = Value extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<Value>
  : Record<string, unknown>;
export type ComputedContext<Data, Source = unknown> = {
  /** The collection's key in the configured registry. */
  collection: string;
  id: string;
  /** Loader-provided source metadata, detached from stored entries for this resolver. */
  source?: Source extends object ? Readonly<Source> : Source;
  data: Readonly<Data>;
  readBody(this: void): Promise<string | undefined>;
  signal: AbortSignal;
};
export type ComputedDefinition<Data = Record<string, unknown>, Source = unknown> = {
  schema: Schema;
  resolve(context: ComputedContext<Data, Source>): unknown;
};
/** Context for a payload's `combinations()` override, with the entry's prepared data. */
export type VariantContext<Data, Source = unknown> = {
  /** The collection's key in the configured registry. */
  collection: string;
  id: string;
  /** Loader-provided source metadata, detached from stored entries for this resolver. */
  source?: Source extends object ? Readonly<Source> : Source;
  /** Validated metadata plus computed fields. */
  data: Readonly<Data>;
  signal: AbortSignal;
};
/** Context for a custom payload resolver, called once per entry and variant combination. */
export type PayloadContext<Data, Source = unknown, Variant = {}> = VariantContext<Data, Source> & {
  /** The variant combination being resolved; empty for payloads without variants. */
  variant: Readonly<Variant>;
  readBody(this: void): Promise<string | undefined>;
};
/** Data fields, including computed fields, whose values are string arrays. */
export type VariantField<Data> = {
  [Field in keyof Data]-?: NonNullable<Data[Field]> extends readonly string[] ? Field : never;
}[keyof Data] &
  string;
/**
 * Enumerates one variant key's values: the name of a string-array data field, read per entry, or
 * a fixed list. Derive values in a computed field when they need logic.
 */
export type VariantValues<Data> = VariantField<Data> | readonly string[];
/**
 * A custom payload: schema-validated data resolved during preparation and loaded only when a
 * query requests it. Names cannot start with `_`, which built-in payloads such as `_body` use.
 */
export type PayloadDefinition<Data = Record<string, unknown>, Source = unknown, Variant = {}> = {
  schema: Schema;
  /** Variant keys and their values for an entry. Omit for a single payload value. */
  variants?: Record<string, VariantValues<Data>>;
  /**
   * Overrides the default cross product of enumerated values. Each combination must name every
   * variant key with one of that key's enumerated values.
   */
  combinations?(
    context: VariantContext<Data, Source> & {
      variants: Readonly<Record<string, readonly string[]>>;
    },
  ): Iterable<Variant> | PromiseLike<Iterable<Variant>>;
  resolve(context: PayloadContext<Data, Source, Variant>): unknown;
};
/**
 * Any payload declaration once its inferred types are erased, as registries and preparation see
 * it. Typed declarations from `defineCollection` are always assignable.
 */
export type PayloadDeclaration = {
  schema: Schema;
  variants?: Record<string, string | readonly string[]>;
  combinations?(context: never): unknown;
  resolve(context: never): unknown;
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
  Computed extends Record<string, ComputedDefinition<never, never>> = Record<
    string,
    ComputedDefinition<never, never>
  >,
  Relationships extends Record<string, Relationship> = Record<string, Relationship>,
> = {
  loader: Loader;
  schema?: SourceSchema;
  computed?: Computed;
  relationships?: Relationships;
  payloads?: Record<string, PayloadDeclaration>;
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
/**
 * Payloads that Markdown sources, `glob()`, and custom loaders provide for every entry.
 * Built-in names start with an underscore, so they never collide with custom payloads.
 */
export type BuiltinPayloads = {
  /** The retained raw body, or undefined when the entry has none or retention is disabled. */
  _body: string | undefined;
  /** HTML and headings; entries without a rendering path reject with `not-renderable`. */
  _rendered: ContentRenderResult;
};
/** Type-only marker recording which built-in payloads a defined collection carries. */
export type BuiltinPayloadMarker<Available extends keyof BuiltinPayloads> = {
  readonly [builtinPayloadsType]?: Available;
};
/** One custom payload's validated value type and variant record, as recorded by a definition. */
export type CustomPayload<Value = unknown, Variant = {}> = { value: Value; variant: Variant };
/** Type-only marker recording a defined collection's custom payload values and variant keys. */
export type CustomPayloadMarker<Payloads extends Record<string, CustomPayload>> = {
  readonly [customPayloadsType]?: Payloads;
};
type CustomPayloadsOf<Definition> = Definition extends {
  readonly [customPayloadsType]?: infer Payloads;
}
  ? Payloads extends Record<string, CustomPayload>
    ? Payloads
    : {}
  : {};
/** Payload names and value types that queries can request for a collection definition. */
export type PayloadsOf<Definition> = (Definition extends {
  readonly [builtinPayloadsType]?: infer Available;
}
  ? Pick<BuiltinPayloads, Available & keyof BuiltinPayloads>
  : BuiltinPayloads) & {
  [
    Name in keyof CustomPayloadsOf<Definition>
  ]: CustomPayloadsOf<Definition>[Name] extends CustomPayload<infer Value> ? Value : never;
};
/** The value type of one payload that queries return under `_payloads`. */
export type PayloadData<
  Definition,
  Name extends keyof PayloadsOf<Definition>,
> = PayloadsOf<Definition>[Name];
/** The variant keys a payload request must supply; empty for built-in and single-value payloads. */
export type VariantOf<Definition, Name> = Name extends keyof CustomPayloadsOf<Definition>
  ? CustomPayloadsOf<Definition>[Name] extends CustomPayload<unknown, infer Variant>
    ? Variant
    : {}
  : {};
