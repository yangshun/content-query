import path from "node:path";

/**
 * Generates type-only consumer bindings without loading schemas or adding runtime imports.
 *
 * The registry and the optional `queryStyle` both come from the config module's types, so a
 * literal `export const queryStyle = "relational"` narrows `content` without a rebuild. A missing
 * export, or one typed as the whole `QueryStyle` union, allows both query styles.
 *
 * `CollectionEntry<Name>` is the full entry. `CollectionEntry<Name, Field>` is the shape a query
 * returns when it selects `Field`: every selected key is present, and optional fields read as
 * `undefined` when missing, so query results and the type are assignable in both directions.
 *
 * @param directory - Directory that will contain the declaration file.
 * @param config - Absolute path of content-query.config.
 * @returns Declaration source for `server.d.ts`.
 */
export function contentDeclarations(directory: string, config: string): string {
  let relative = path.relative(directory, config).replace(/\\/g, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  const source = JSON.stringify(relative);
  const entry = `import("content-query").QueryData<Registry[Name]>`;
  return [
    `type Registry = typeof import(${source}).collections;`,
    `type ConfiguredQueryStyle = typeof import(${source}) extends { queryStyle: infer Style extends import("content-query/runtime").QueryStyle } ? Style : import("content-query/runtime").QueryStyle;`,
    `/** Names of the collections in the configured registry. */`,
    `export type CollectionKey = keyof Registry & string;`,
    `/** A collection entry: its ID, validated metadata, and computed fields. Pass field names, such as \`CollectionEntry<"posts", "id" | "title">\`, for the shape a query returns when it selects them. */`,
    `export type CollectionEntry<Name extends CollectionKey, Field extends keyof ${entry} = keyof ${entry}> = keyof ${entry} extends Field ? ${entry} : { [Key in Field]: ${entry}[Key] };`,
    `/** Maps each collection name to its full entry type. */`,
    `export type Collections = { [Name in CollectionKey]: CollectionEntry<Name> };`,
    `/** The value of one payload that a collection declares. */`,
    `export type CollectionPayload<Name extends CollectionKey, Payload extends keyof import("content-query").PayloadsOf<Registry[Name]>> = import("content-query").PayloadData<Registry[Name], Payload>;`,
    `export declare const content: import("content-query/runtime").Content<Registry, ConfiguredQueryStyle>;`,
    ``,
  ].join("\n");
}

/**
 * Declares project-bound virtual server types and the framework-neutral development bridge.
 *
 * @param directory - Directory that will contain the declaration file.
 * @param config - Absolute path of content-query.config.
 * @returns Declaration source for the `content-query:server` and `content-query:client` modules.
 */
export function virtualDeclarations(directory: string, config: string): string {
  return `declare module "content-query:server" {\n${contentDeclarations(directory, config).replace("export declare const", "export const")}\n}\ndeclare module "content-query:client" {\n  export function onContentUpdate(callback: () => void | Promise<void>): () => void;\n}\n`;
}
