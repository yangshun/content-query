import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";
import type { CollectionRegistry } from "../collection/types.ts";
import type { LoaderConfig } from "../loaders/types.ts";

export type LoadedConfiguration = {
  registry: CollectionRegistry;
  /** Modules whose edits a reload can observe: the config and every module Jiti transpiled. */
  dependencies: ReadonlySet<string>;
  loaderConfig?: Partial<LoaderConfig>;
};

/** Loads build-only configuration without retaining a previous config module value. */
export async function loadRegistry(config: string): Promise<LoadedConfiguration> {
  const filename = await realpath(config);
  const dependencies = new Set([filename]);
  // Native JS imports retain Node's module cache even when Jiti's cache is disabled, so only
  // transpiled modules are re-evaluated on reload. Record exactly those for development watching.
  const transpiler = createJiti(filename, { moduleCache: false, fsCache: false });
  const jiti = createJiti(filename, {
    moduleCache: false,
    fsCache: false,
    transform: (options) => {
      if (options.filename) {
        dependencies.add(path.resolve(options.filename));
      }
      return { code: transpiler.transform(options) };
    },
  });
  const imported = (await jiti.evalModule(await readFile(filename, "utf8"), {
    filename,
    async: true,
    forceTranspile: true,
  })) as { collections?: unknown; loaderConfig?: Partial<LoaderConfig> };
  if (
    imported.loaderConfig !== undefined &&
    (!imported.loaderConfig ||
      typeof imported.loaderConfig !== "object" ||
      Array.isArray(imported.loaderConfig))
  ) {
    throw new Error("content-query.config loaderConfig must be an object.");
  }
  const registry = imported.collections;
  if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
    throw new Error("content-query.config must export a collections registry.");
  }
  for (const [name, definition] of Object.entries(registry)) {
    if (
      !name ||
      !definition ||
      typeof definition !== "object" ||
      !("loader" in definition) ||
      !definition.loader ||
      typeof definition.loader !== "object" ||
      !("name" in definition.loader) ||
      typeof definition.loader.name !== "string" ||
      !definition.loader.name ||
      !("load" in definition.loader) ||
      typeof definition.loader.load !== "function"
    ) {
      throw new Error(`Collection "${name}" requires a named loader object with load(context).`);
    }
  }
  return {
    registry: registry as CollectionRegistry,
    dependencies,
    loaderConfig: imported.loaderConfig,
  };
}
