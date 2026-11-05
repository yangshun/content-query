import path from "node:path";
import type { CollectionNames } from "../collection/names.ts";

/** Declares the config-bound `Registry` and `ConfiguredQueryStyle` aliases for one directory. */
function configTypes(directory: string, config: string): string[] {
  let relative = path.relative(directory, config).replace(/\\/g, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  const source = JSON.stringify(relative);
  return [
    `type Registry = typeof import(${source}).collections;`,
    `type ConfiguredQueryStyle = typeof import(${source}) extends { queryStyle: infer Style extends import("content-query/runtime").QueryStyle } ? Style : import("content-query/runtime").QueryStyle;`,
  ];
}

/**
 * Generates type-only bindings for one collection entry without loading schemas or adding runtime
 * imports.
 *
 * The registry and the optional `queryStyle` both come from the config module's types, so a
 * literal `export const queryStyle = "relational"` narrows the export without a rebuild. A missing
 * export, or one typed as the whole `QueryStyle` union, allows both query styles.
 *
 * The entry type, such as `ContentJob`, is the full entry. `ContentJob<Field>` is the shape a
 * query returns when it selects `Field`: every selected key is present, and optional fields read
 * as `undefined` when missing, so query results and the type are assignable in both directions.
 * Both forms keep JSDoc comments written on schema fields and computed field names.
 *
 * @param directory - Directory that will contain the declaration file.
 * @param config - Absolute path of content-query.config.
 * @param name - The collection's name in the registry.
 * @param names - The collection's generated export and type names.
 * @returns Declaration source for the entry's `server.d.ts`.
 */
export function collectionDeclarations(
  directory: string,
  config: string,
  name: string,
  { exportName, typeName, payloadTypeName }: CollectionNames,
): string {
  const key = JSON.stringify(name);
  const definition = `Registry[${key}]`;
  const data = `import("content-query").QueryData<${definition}>`;
  return [
    ...configTypes(directory, config),
    `/** The ${exportName} collection. Start queries here, or pass it to another collection's \`using()\` to follow relationships into it. */`,
    `export declare const ${exportName}: import("content-query/runtime").Collection<Registry, ${key}, ConfiguredQueryStyle>;`,
    `/** A ${exportName} entry: its ID, validated metadata, and computed fields. Pass field names, such as \`${typeName}<"id">\`, for the shape a query returns when it selects them. */`,
    `export type ${typeName}<Field extends keyof ${data} = keyof ${data}> = keyof ${data} extends Field ? ${data} : import("content-query").SelectedData<${data}, Field>;`,
    `/** The value of one payload that the ${exportName} collection declares. */`,
    `export type ${payloadTypeName}<Payload extends keyof import("content-query").PayloadsOf<${definition}>> = import("content-query").PayloadData<${definition}, Payload>;`,
    ``,
  ].join("\n");
}

/**
 * Declares project-bound virtual collection modules and the framework-neutral development bridge.
 *
 * @param directory - Directory that will contain the declaration file.
 * @param config - Absolute path of content-query.config.
 * @param names - Every collection's generated names, keyed by collection name.
 * @returns Declaration source for the `content-query:collections/<export name>` and
 * `content-query:client` modules, plus the type-only `content-query:collections` module, whose
 * `CollectionKey` names every collection for integrations that accept a collection name.
 */
export function virtualDeclarations(
  directory: string,
  config: string,
  names: ReadonlyMap<string, CollectionNames>,
): string {
  const collections = [...names].map(
    ([name, generated]) =>
      `declare module "content-query:collections/${generated.exportName}" {\n${collectionDeclarations(directory, config, name, generated).replace("export declare const", "export const")}}\n`,
  );
  const keys = `declare module "content-query:collections" {\n${configTypes(directory, config)[0]}\n/** Names of the configured collections, for integrations that accept a collection name. Types only: import collections from their own modules. */\nexport type CollectionKey = keyof Registry & string;\n}\n`;
  return `${collections.join("")}${keys}declare module "content-query:client" {\n  export function onContentUpdate(callback: () => void | Promise<void>): () => void;\n}\n`;
}
