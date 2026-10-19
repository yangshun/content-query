import { stat } from "node:fs/promises";
import path from "node:path";
import { ContentError, contentError } from "../shared/errors.ts";

const extensions = ["ts", "mts", "cts", "js", "mjs", "cjs"];

/** Lists default config paths, or the exact explicitly selected file, from the host root. */
export function configCandidates(root: string, config?: string): string[] {
  return config === undefined
    ? extensions.map((extension) => path.resolve(root, `content-query.config.${extension}`))
    : [path.resolve(root, config)];
}

/** Discovers exactly one config file without evaluating candidates or guessing explicit paths. */
export async function resolveConfigPath(root: string, config?: string): Promise<string> {
  const candidates = configCandidates(root, config);
  if (config !== undefined) {
    return candidates[0]!;
  }
  const files = await Promise.all(
    candidates.map(async (filename) => {
      try {
        return (await stat(filename)).isFile();
      } catch (cause) {
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          (cause.code === "ENOENT" || cause.code === "ENOTDIR")
        ) {
          return false;
        }
        throw contentError(cause, {
          code: "source-error",
          operation: "build",
          source: filename,
          message: `Could not inspect ContentQuery configuration "${filename}".`,
        });
      }
    }),
  );
  const matches = candidates.filter((_filename, index) => files[index]);
  if (matches.length === 1) {
    return matches[0]!;
  }
  throw new ContentError({
    code: "source-error",
    operation: "build",
    source: path.resolve(root),
    message: matches.length
      ? `Multiple ContentQuery configuration files found: ${matches.map((filename) => path.basename(filename)).join(", ")}. Set the config option to choose one.`
      : `No ContentQuery configuration found in "${path.resolve(root)}". Expected content-query.config.{${extensions.join(",")}}, or set the config option to an exact path.`,
  });
}
