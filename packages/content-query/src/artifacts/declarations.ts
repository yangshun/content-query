import path from "node:path";

/** Generates type-only consumer bindings without loading schemas or adding runtime imports. */
export function contentDeclarations(directory: string, config: string): string {
  let relative = path.relative(directory, config).replace(/\\/g, "/");
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return `type Registry = typeof import(${JSON.stringify(relative)}).collections;\nexport type CollectionKey = keyof Registry & string;\nexport type CollectionData<Name extends CollectionKey> = import("content-query").QueryData<Registry[Name]>;\nexport type Collections = { [Name in CollectionKey]: CollectionData<Name> };\nexport declare const content: import("content-query/runtime").Content<Registry>;\n`;
}

/** Declares project-bound virtual server types and the framework-neutral development bridge. */
export function virtualDeclarations(directory: string, config: string): string {
  return `declare module "content-query:server" {\n${contentDeclarations(directory, config).replace("export declare const", "export const")}\n}\ndeclare module "content-query:client" {\n  export function onContentUpdate(callback: () => void | Promise<void>): () => void;\n}\n`;
}
