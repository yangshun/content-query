import { builtinLoader } from "../loaders/descriptor.ts";
import type { PayloadDescriptor, QueryRegistry } from "../query/plan.ts";
import type { CollectionSource } from "./source.ts";
import type { CollectionDefinition, CollectionRegistry } from "./types.ts";

/** Built-in payload names start with an underscore, which custom payload names cannot use. */
const builtinPayloads: Record<string, PayloadDescriptor> = {
  _body: { variants: [] },
  _rendered: { variants: [] },
};

/**
 * Reports whether a collection can carry built-in `_body` and `_rendered` payloads.
 * This depends only on the declaration, never on the entries a source currently contains.
 *
 * @param definition - A collection definition, including the `source` shorthand when used.
 * @returns False for JSON, YAML, and TOML sources and `file()` loaders; true otherwise.
 */
export function hasBuiltinPayloads(definition: CollectionDefinition): boolean {
  const source = (definition as { source?: CollectionSource }).source;
  if (source !== undefined) {
    return typeof source === "string" || source.type === "markdown";
  }
  return builtinLoader(definition.loader)?.kind !== "file";
}

/**
 * Builds the query registry that runtimes validate queries against, without resolvers or schemas.
 *
 * @param registry - The configured collection definitions.
 * @returns Relationship and payload descriptors for each collection.
 */
export function queryRegistry(registry: CollectionRegistry): QueryRegistry {
  return Object.fromEntries(
    Object.entries(registry).map(([name, definition]) => [
      name,
      {
        relationships: definition.relationships ?? {},
        payloads: hasBuiltinPayloads(definition) ? { ...builtinPayloads } : {},
      },
    ]),
  );
}
