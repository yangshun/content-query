import path from "node:path";
import { realpath } from "node:fs/promises";

/** Checks containment without confusing sibling prefixes, drive roots, or trailing separators. */
export function withinDirectory(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/** Resolves existing symlink ancestors even when the output directory does not exist yet. */
export async function canonicalPath(filename: string): Promise<string> {
  try {
    return await realpath(filename);
  } catch (cause) {
    if (!cause || typeof cause !== "object" || !("code" in cause) || cause.code !== "ENOENT") {
      throw cause;
    }
    const parent = path.dirname(filename);
    if (parent === filename) {
      throw cause;
    }
    return path.join(await canonicalPath(parent), path.basename(filename));
  }
}
