import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  BuiltinPayloadMarker,
  BuiltinPayloads,
  ComputedContext,
  CustomPayload,
  CustomPayloadMarker,
  PayloadContext,
  Relationship,
  Schema,
  SchemaOutput,
  VariantContext,
  VariantValues,
} from "./types.ts";
import { sourceLoader, type CollectionSource } from "./source.ts";
import type {
  BodyLoader,
  FileSource,
  Loader,
  LoaderSource,
  RecordLoader,
} from "../loaders/types.ts";

/** Local sources whose entries are data records, without bodies or rendered output. */
type RecordSource = Extract<CollectionSource, object> & { type: "json" | "yaml" | "toml" };

/** Variant values are typed `string`, so inference never depends on declaration order. */
type VariantRecord<Keys> = { [Key in keyof Keys]: string };

/** Metadata plus computed fields, as payload enumerators and resolvers receive them. */
type PayloadData<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
> = SchemaOutput<NoInfer<SourceSchema>> & {
  [Field in keyof NoInfer<ComputedSchemas>]: SchemaOutput<NoInfer<ComputedSchemas>[Field]>;
};

/**
 * Custom payload declarations. Schemas and variant keys are inferred through separate mapped
 * types, so resolvers are contextually typed without annotations. Variant values are data field
 * names or fixed lists rather than callbacks: TypeScript cannot infer keys from an object whose
 * values are all unannotated callbacks.
 */
type PayloadDeclarations<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
  Source,
> = { [Name in keyof PayloadSchemas]: { schema: PayloadSchemas[Name] } } & {
  [Name in keyof PayloadVariants]: {
    variants?: {
      [Key in keyof PayloadVariants[Name]]: VariantValues<
        PayloadData<SourceSchema, ComputedSchemas>
      >;
    };
    combinations?(
      context: VariantContext<PayloadData<SourceSchema, ComputedSchemas>, Source> & {
        variants: Readonly<{ [Key in keyof NoInfer<PayloadVariants>[Name]]: readonly string[] }>;
      },
    ):
      | Iterable<VariantRecord<NoInfer<PayloadVariants>[Name]>>
      | PromiseLike<Iterable<VariantRecord<NoInfer<PayloadVariants>[Name]>>>;
    resolve(
      context: PayloadContext<
        PayloadData<SourceSchema, ComputedSchemas>,
        Source,
        VariantRecord<NoInfer<PayloadVariants>[Name]>
      >,
    ): unknown;
  };
} & ReservedPayloadNames<NoInfer<PayloadSchemas>>;

/**
 * Rejects underscore payload names, which built-ins own. A conditional keeps declaration inference
 * intact, unlike a key-remapped mapped type.
 */
type ReservedPayloadNames<PayloadSchemas> =
  Extract<keyof PayloadSchemas, `_${string}`> extends never
    ? unknown
    : {
        "Custom payload names cannot start with an underscore": Extract<
          keyof PayloadSchemas,
          `_${string}`
        >;
      };

type CollectionFields<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
  Source,
> = {
  schema?: SourceSchema;
  computed?: {
    [Name in keyof ComputedSchemas]: {
      schema: ComputedSchemas[Name];
      resolve(context: ComputedContext<SchemaOutput<NoInfer<SourceSchema>>, Source>): unknown;
    };
  };
  relationships?: Relationships & {
    [Name in keyof Relationships]: {
      from: keyof (SchemaOutput<NoInfer<SourceSchema>> & { id: string } & {
        [Field in keyof ComputedSchemas]: SchemaOutput<ComputedSchemas[Field]>;
      }) &
        string;
    };
  };
  /** Named per-entry data resolved during preparation and loaded only when a query requests it. */
  payloads?: PayloadDeclarations<
    SourceSchema,
    ComputedSchemas,
    PayloadSchemas,
    PayloadVariants,
    Source
  >;
};

type Definition<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
  ContentLoader extends Loader,
> =
  | ({ source: CollectionSource; loader?: never } & CollectionFields<
      SourceSchema,
      ComputedSchemas,
      Relationships,
      PayloadSchemas,
      PayloadVariants,
      FileSource
    >)
  | ({ loader: ContentLoader; source?: never } & CollectionFields<
      SourceSchema,
      ComputedSchemas,
      Relationships,
      PayloadSchemas,
      PayloadVariants,
      LoaderSource<NoInfer<ContentLoader>>
    >);

/** Records each declared payload's validated value type and variant record. */
type PayloadMarker<
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
> = CustomPayloadMarker<{
  [Name in keyof PayloadSchemas & string]: CustomPayload<
    SchemaOutput<PayloadSchemas[Name]>,
    VariantRecord<PayloadVariants[Name & keyof PayloadVariants]>
  >;
}>;

/** Normalizes either declaration form into a definition with a native loader. */
function collectionOf<
  SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
  ContentLoader extends Loader,
>(
  definition: Definition<
    SourceSchema,
    ComputedSchemas,
    Relationships,
    PayloadSchemas,
    PayloadVariants,
    ContentLoader
  >,
) {
  if (definition.source !== undefined && definition.loader !== undefined) {
    throw new TypeError("Specify either source or loader, not both.");
  }
  const loader = definition.loader ?? sourceLoader(definition.source!);
  return {
    ...definition,
    loader,
    schema: definition.schema as SourceSchema,
    computed: definition.computed ?? ({} as NonNullable<typeof definition.computed>),
    relationships: definition.relationships ?? ({} as Relationships),
  };
}
type Defined<
  SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  PayloadSchemas extends Record<string, Schema>,
  PayloadVariants extends Record<string, unknown>,
  ContentLoader extends Loader,
> = ReturnType<
  typeof collectionOf<
    SourceSchema,
    ComputedSchemas,
    Relationships,
    PayloadSchemas,
    PayloadVariants,
    ContentLoader
  >
> &
  PayloadMarker<PayloadSchemas, PayloadVariants>;

/**
 * Declares fields with inferred schema data and optional loader source metadata, plus
 * relationships and custom payloads. JSON, YAML, and TOML sources carry no built-in `_body` or
 * `_rendered` payloads.
 */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
  const PayloadSchemas extends Record<string, Schema> = {},
  const PayloadVariants extends Record<string, unknown> = {},
>(
  definition: { source: RecordSource; loader?: never } & CollectionFields<
    SourceSchema,
    ComputedSchemas,
    Relationships,
    PayloadSchemas,
    PayloadVariants,
    FileSource
  >,
): Defined<SourceSchema, ComputedSchemas, Relationships, PayloadSchemas, PayloadVariants, Loader> &
  BuiltinPayloadMarker<never>;
/**
 * Declares fields with inferred schema data and optional loader source metadata, plus
 * relationships and custom payloads. Record loaders such as `file()` carry no built-in `_body` or
 * `_rendered` payloads, and body loaders carry `_body` without `_rendered`.
 */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
  const PayloadSchemas extends Record<string, Schema> = {},
  const PayloadVariants extends Record<string, unknown> = {},
  const ContentLoader extends Loader = Loader,
>(
  definition: Definition<
    SourceSchema,
    ComputedSchemas,
    Relationships,
    PayloadSchemas,
    PayloadVariants,
    ContentLoader
  >,
): Defined<
  SourceSchema,
  ComputedSchemas,
  Relationships,
  PayloadSchemas,
  PayloadVariants,
  ContentLoader
> &
  BuiltinPayloadMarker<
    [ContentLoader] extends [RecordLoader]
      ? never
      : [ContentLoader] extends [BodyLoader]
        ? "_body"
        : keyof BuiltinPayloads
  >;
export function defineCollection(
  definition: Definition<
    StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
    Record<string, Schema>,
    Record<string, Relationship>,
    Record<string, Schema>,
    Record<string, unknown>,
    Loader
  >,
) {
  return collectionOf(definition);
}
