import { glob } from "../loaders/glob.ts";
import type { GlobOptions } from "../loaders/descriptor.ts";
import type { Loader } from "../loaders/types.ts";

export type CollectionSource =
  | string
  | ({
      type: "markdown" | "json" | "yaml" | "toml";
      directory: string | URL;
      include?: string | string[];
    } & Pick<GlobOptions, "generateId" | "retainBody" | "deferRender">);

export type CollectionInput =
  | { source: CollectionSource; loader?: never }
  | { loader: Loader; source?: never };

const patterns = {
  markdown: "**/*.md",
  json: "**/*.json",
  yaml: "**/*.{yaml,yml}",
  toml: "**/*.toml",
} as const;

/** Normalizes local-source convenience declarations into the existing native glob loader. */
export function sourceLoader(source: CollectionSource): Loader {
  const options =
    typeof source === "string" ? { type: "markdown" as const, directory: source } : source;
  if (
    !options ||
    !Object.hasOwn(patterns, options.type) ||
    !options.directory ||
    (typeof options.directory !== "string" && !(options.directory instanceof URL))
  ) {
    throw new TypeError(
      "source requires a directory and a supported type: markdown, json, yaml, or toml.",
    );
  }
  return glob({
    base: options.directory,
    pattern: options.include ?? patterns[options.type],
    ...("generateId" in options ? { generateId: options.generateId } : {}),
    ...("retainBody" in options ? { retainBody: options.retainBody } : {}),
    ...("deferRender" in options ? { deferRender: options.deferRender } : {}),
  });
}
