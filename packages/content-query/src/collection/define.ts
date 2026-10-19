import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ComputedContext, Relationship, Schema, SchemaOutput } from "./types.ts";
import { sourceLoader, type CollectionInput } from "./source.ts";

/** Declares preparation-only fields and relationships, inheriting the loader schema when omitted. */
export function defineCollection<
  const SourceSchema extends StandardSchemaV1<unknown, Record<string, unknown>> | undefined =
    undefined,
  const ComputedSchemas extends Record<string, Schema> = {},
  const Relationships extends Record<string, Relationship> = {},
>(
  definition: CollectionInput & {
    schema?: SourceSchema;
    computed?: {
      [Name in keyof ComputedSchemas]: {
        schema: ComputedSchemas[Name];
        resolve(context: ComputedContext<SchemaOutput<NoInfer<SourceSchema>>>): unknown;
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
  },
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
