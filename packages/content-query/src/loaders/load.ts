import { loadFile } from "./file.ts";
import { loadGlob } from "./glob.ts";
import type { BuiltinLoader } from "./descriptor.ts";
import type { LoaderEntry } from "./types.ts";

/** Acquires a library-owned source relative to its preparation host. */
export function loadBuiltin(
  descriptor: BuiltinLoader,
  root: string,
  signal: AbortSignal,
): Promise<LoaderEntry[]> {
  return descriptor.kind === "file"
    ? loadFile(descriptor, root, signal)
    : loadGlob(descriptor, root, signal);
}
