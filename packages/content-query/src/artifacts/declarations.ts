import path from "node:path";

/**
 * Generates type-only consumer bindings without loading schemas or adding runtime imports.
 *
 * The registry and the optional `queryStyle` both come from the config module's types, so a
 * literal `export const queryStyle = "relational"` narrows `content` without a rebuild. A missing
 * export, or one typed as the whole `QueryStyle` union, allows both query styles.
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
  return [
    `type Registry = typeof import(${source}).collections;`,
    `type ConfiguredQueryStyle = typeof import(${source}) extends { queryStyle: infer Style extends import("content-query/runtime").QueryStyle } ? Style : import("content-query/runtime").QueryStyle;`,
    `export type CollectionKey = keyof Registry & string;`,
    `export type CollectionData<Name extends CollectionKey> = import("content-query").QueryData<Registry[Name]>;`,
    `export type Collections = { [Name in CollectionKey]: CollectionData<Name> };`,
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
