import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MaybePromise } from "../shared/types.ts";
import type { Loader } from "./types.ts";

export type GlobOptions = {
  pattern: string | string[];
  base?: string | URL;
  generateId?: (context: { entry: string; base: URL; data: Record<string, unknown> }) => string;
  retainBody?: boolean;
  deferRender?: boolean;
};
export type FileOptions = { parser?: (text: string) => MaybePromise<unknown> };
export type BuiltinLoader =
  | { kind: "glob"; options: GlobOptions }
  | { kind: "file"; filename: string; options: FileOptions };
export const builtinSymbol = Symbol.for("content-query.builtin-loader");
export type MarkedLoader = Loader & { [builtinSymbol]: BuiltinLoader };

/** Finds library-owned loader settings without depending on module instance identity. */
export function builtinLoader(loader: Loader): BuiltinLoader | undefined {
  return (loader as Partial<MarkedLoader>)[builtinSymbol];
}

/** Resolves a loader's watch root from the application root, including file URLs. */
export function builtinPath(descriptor: BuiltinLoader, root: string): string {
  if (descriptor.kind === "file") {
    return path.resolve(root, descriptor.filename);
  }
  return descriptor.options.base instanceof URL
    ? path.resolve(fileURLToPath(descriptor.options.base))
    : path.resolve(root, descriptor.options.base ?? ".");
}
