import { readFile } from "node:fs/promises";
import { builtinPath, builtinSymbol, type BuiltinLoader, type MarkedLoader } from "./descriptor.ts";
import type { FileSource, Loader, LoaderEntry } from "./types.ts";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { populateStore } from "./populate.ts";
import { glob as discover } from "tinyglobby";
import { slug } from "github-slugger";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";
import { ContentError, contentError, describeCause, groupDiagnostics } from "../shared/errors.ts";
import type { GlobOptions } from "./descriptor.ts";
import { parseData, recordData, coerceIdentity } from "./parse.ts";

/** Declares local files with Astro-style IDs and typed, project-relative source paths. */
export function glob(options: GlobOptions): Loader<FileSource> {
  if (
    !options ||
    !(
      typeof options.pattern === "string" ||
      (Array.isArray(options.pattern) &&
        options.pattern.every((pattern) => typeof pattern === "string"))
    )
  ) {
    throw new TypeError("glob() requires a string or string[] pattern.");
  }
  const descriptor: BuiltinLoader = { kind: "glob", options };
  return {
    [builtinSymbol]: descriptor,
    name: "content-query/glob",
    async load(context) {
      const entries = await loadGlob(
        descriptor,
        fileURLToPath(context.config.root),
        context.signal ?? new AbortController().signal,
      );
      await populateStore(context, entries);
    },
  } as MarkedLoader<FileSource>;
}

/** Captures complete matching Markdown and data sources before deployment. */
export async function loadGlob(
  descriptor: Extract<BuiltinLoader, { kind: "glob" }>,
  root: string,
  signal: AbortSignal,
): Promise<LoaderEntry<FileSource>[]> {
  const resolved = builtinPath(descriptor, root);
  const entries = await discover(descriptor.options.pattern, {
    cwd: resolved,
    onlyFiles: true,
    dot: false,
  });
  if (entries.length === 0) {
    console.warn(
      `[content-query] No content matched ${JSON.stringify(descriptor.options.pattern)} in ${resolved}.`,
    );
  }
  const base = pathToFileURL(`${resolved}${path.sep}`);
  const results = await Promise.allSettled(
    entries.sort().map(async (entry) => {
      signal.throwIfAborted();
      const filename = path.join(resolved, entry);
      try {
        return {
          ...(await loadEntry(descriptor, entry, filename, base, signal)),
          sourceData: { filePath: path.relative(root, filename).split(path.sep).join("/") },
        };
      } catch (cause) {
        throw contentError(cause, {
          code: "source-error",
          source: filename,
          message: `Could not load "${entry}": ${describeCause(cause)}`,
          cause,
        });
      }
    }),
  );
  signal.throwIfAborted();
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? (result.reason as ContentError).diagnostics : [],
  );
  if (failures.length) {
    throw groupDiagnostics(failures);
  }
  return results.map((result) => (result as PromiseFulfilledResult<LoaderEntry<FileSource>>).value);
}

/** Captures one matched file's metadata and Markdown body from a single read. */
async function loadEntry(
  descriptor: Extract<BuiltinLoader, { kind: "glob" }>,
  entry: string,
  filename: string,
  base: URL,
  signal: AbortSignal,
): Promise<LoaderEntry> {
  const text = await readFile(filename, { encoding: "utf8", signal });
  const markdown = path.extname(entry).toLowerCase() === ".md";
  let data: Record<string, unknown>;
  let body: string | undefined;
  if (markdown) {
    const frontmatter = matter(text, {
      engines: {
        yaml: (source) => parseYaml(source) as object,
        toml: (source) => parseToml(source),
      },
      ...(text.startsWith("+++") ? { delimiters: "+++", language: "toml" } : {}),
    });
    data = recordData(frontmatter.data);
    // Blank lines separating frontmatter from content are not part of the authored body.
    body = frontmatter.content.replace(/^(?:[ \t]*\r?\n)+/, "");
  } else {
    data = recordData(parseData(text, filename));
  }
  const defaultId = data.slug
    ? coerceIdentity(data.slug)
    : entry
        .replace(/\\/g, "/")
        .replace(/\.[^.]+$/, "")
        .split("/")
        .map((segment) => slug(segment))
        .join("/")
        .replace(/\/index$/, "");
  const id = descriptor.options.generateId
    ? descriptor.options.generateId({ entry: entry.replace(/\\/g, "/"), base, data })
    : defaultId;
  if (typeof id !== "string" || !id) {
    throw new ContentError({
      code: "source-error",
      source: filename,
      message: "generateId must produce a nonempty string.",
    });
  }
  return { id, data, ...(body === undefined ? {} : { body }), source: filename };
}
