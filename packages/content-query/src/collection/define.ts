import type { StandardSchemaV1 } from "@standard-schema/spec";
import type {
  BuiltinPayloadMarker,
  ComputedContext,
  Relationship,
  Schema,
  SchemaOutput,
} from "./types.ts";
import { sourceLoader, type CollectionSource } from "./source.ts";
import type { FileSource, Loader, LoaderSource, RecordLoader } from "../loaders/types.ts";

/** Local sources whose entries are data records, without bodies or rendered output. */
type RecordSource = Extract<CollectionSource, object> & { type: "json" | "yaml" | "toml" };

type CollectionFields<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
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
};

type Definition<
  SourceSchema extends Schema | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  ContentLoader extends Loader,
> =
  | ({ source: CollectionSource; loader?: never } & CollectionFields<
      SourceSchema,
      ComputedSchemas,
      Relationships,
      FileSource
    >)
  | ({ loader: ContentLoader; source?: never } & CollectionFields<
      SourceSchema,
      ComputedSchemas,
      Relationships,
      LoaderSource<NoInfer<ContentLoader>>
    >);

/** Normalizes either declaration form into a definition with a native loader. */
function collectionOf<
  SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
  ComputedSchemas extends Record<string, Schema>,
  Relationships extends Record<string, Relationship>,
  ContentLoader extends Loader,
>(definition: Definition<SourceSchema, ComputedSchemas, Relationships, ContentLoader>) {
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
  ContentLoader extends Loader,
> = ReturnType<typeof collectionOf<SourceSchema, ComputedSchemas, Relationships, ContentLoader>>;

/**
 * Declares fields with inferred schema data and optional loader source metadata, plus relationships.
 * JSON, YAML, and TOML sources carry no built-in `_body` or `_rendered` payloads.
 */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
>(
  definition: { source: RecordSource; loader?: never } & CollectionFields<
    SourceSchema,
    ComputedSchemas,
    Relationships,
    FileSource
  >,
): Defined<SourceSchema, ComputedSchemas, Relationships, Loader> & BuiltinPayloadMarker<false>;
/**
 * Declares fields with inferred schema data and optional loader source metadata, plus relationships.
 * Record loaders such as `file()` carry no built-in `_body` or `_rendered` payloads.
 */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
  const ContentLoader extends Loader = Loader,
>(
  definition: Definition<SourceSchema, ComputedSchemas, Relationships, ContentLoader>,
): Defined<SourceSchema, ComputedSchemas, Relationships, ContentLoader> &
  BuiltinPayloadMarker<[ContentLoader] extends [RecordLoader] ? false : true>;
export function defineCollection(
  definition: Definition<
    StandardSchemaV1<unknown, Record<string, unknown>> | undefined,
    Record<string, Schema>,
    Record<string, Relationship>,
    Loader
  >,
) {
  return collectionOf(definition);
}
