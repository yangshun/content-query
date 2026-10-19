import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ComputedContext, Relationship, Schema, SchemaOutput } from "./types.ts";
import { sourceLoader, type CollectionSource } from "./source.ts";
import type { FileSource, Loader, LoaderSource } from "../loaders/types.ts";

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

/** Declares fields with inferred schema data and optional loader source metadata, plus relationships. */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
  const ContentLoader extends Loader = Loader,
>(
  definition:
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
      >),
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
