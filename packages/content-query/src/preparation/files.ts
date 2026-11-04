import { readFile } from "node:fs/promises";
import path from "node:path";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { EntryFiles, FileEntry } from "../collection/types.ts";
import { builtinPath, type GlobOptions } from "../loaders/descriptor.ts";
import { loadFile } from "../loaders/file.ts";
import { loadGlob } from "../loaders/glob.ts";
import { renderMarkdown } from "../runtime/markdown.ts";
import { ContentError, contentError, describeCause } from "../shared/errors.ts";
import { withinDirectory } from "../shared/paths.ts";
import { validate } from "./validation.ts";

/** A file or glob a resolver read; an edit to it re-resolves the node that recorded it. */
export type Dependency =
  | { kind: "file"; path: string }
  | { kind: "glob"; base: string; options: GlobOptions };

export type EntryFilesOptions = {
  /** The project root, which loader source paths are relative to. */
  root: string;
  /** The entry's folder, or undefined when its loader supplies neither a file nor a directory. */
  folder: string | undefined;
  /** Absolute shared directories the collection declares. */
  shared: readonly string[];
  /** Describes the entry for errors, such as a missing folder. */
  entry: string;
  signal: AbortSignal;
  /** Receives every file and glob the helpers read. */
  dependencies: Dependency[];
};

/**
 * Finds the folder an entry's `files` helpers read from: the loader's `source.directory`, or the
 * folder of its `source.filePath`. Both are relative to the project root.
 *
 * @param root - The project root.
 * @param source - The entry's loader-supplied source metadata.
 * @returns The absolute folder, or undefined when the source names neither.
 */
export function entryFolder(root: string, source: unknown): string | undefined {
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const { directory, filePath } = source as { directory?: unknown; filePath?: unknown };
  if (typeof directory === "string" && directory) {
    return path.resolve(root, directory);
  }
  if (typeof filePath === "string" && filePath) {
    return path.resolve(root, path.dirname(filePath));
  }
  return undefined;
}

/**
 * Creates tracked file helpers for one resolver call. Reads are scoped to the entry's folder and
 * the collection's shared directories, and each read is recorded as a dependency.
 *
 * @param options - The entry's roots, cancellation, and the dependency list to record into.
 * @returns The `files` object resolvers receive.
 */
export function createEntryFiles(options: EntryFilesOptions): EntryFiles {
  const { root, folder, shared, entry, signal, dependencies } = options;
  const roots = [...(folder ? [folder] : []), ...shared];

  /** Resolves a path from the entry's folder and rejects one outside every allowed root. */
  function resolve(filePath: string): string {
    if (typeof filePath !== "string" || !filePath) {
      throw new ContentError({
        code: "source-error",
        message: "files helpers require a nonempty path.",
      });
    }
    if (!folder && !path.isAbsolute(filePath)) {
      throw new ContentError({
        code: "source-error",
        message: `Entry "${entry}" has no folder for files helpers. glob() and file() entries use their file's folder, and custom loaders can set source.directory.`,
      });
    }
    const resolved = path.resolve(folder ?? root, filePath);
    if (!roots.some((allowed) => withinDirectory(allowed, resolved))) {
      throw new ContentError({
        code: "source-error",
        source: resolved,
        message: `"${filePath}" is outside entry "${entry}"'s folder and the collection's sharedFiles directories.`,
      });
    }
    return resolved;
  }

  /** Reads a file and records it, reporting a missing or unreadable file as a source error. */
  async function read<Value>(filePath: string, reader: (resolved: string) => Promise<Value>) {
    const resolved = resolve(filePath);
    dependencies.push({ kind: "file", path: resolved });
    try {
      return await reader(resolved);
    } catch (cause) {
      signal.throwIfAborted();
      throw contentError(cause, {
        code: "source-error",
        source: resolved,
        message: `Could not read "${filePath}": ${describeCause(cause)}`,
      });
    }
  }

  /** Validates one helper entry's data, reporting failures against that file. */
  async function entryOf<FileSchema extends StandardSchemaV1 | undefined>(
    schema: FileSchema,
    value: { id: string; data: Record<string, unknown>; body?: string; source?: string },
    filePath: string,
  ): Promise<FileEntry<never>> {
    const data = await validate(schema, value.data, { source: value.source });
    return {
      id: value.id,
      data: data as never,
      ...(value.body === undefined ? {} : { body: value.body }),
      filePath,
    };
  }

  return {
    async glob(globOptions) {
      const { schema, base, ...loaderOptions } = globOptions ?? ({} as typeof globOptions);
      const patterns =
        typeof loaderOptions.pattern === "string" ? [loaderOptions.pattern] : loaderOptions.pattern;
      if (
        !Array.isArray(patterns) ||
        patterns.some(
          (pattern) =>
            typeof pattern !== "string" ||
            path.posix.isAbsolute(pattern.replace(/^!/, "")) ||
            pattern.replace(/^!/, "").split("/").includes(".."),
        )
      ) {
        throw new ContentError({
          code: "source-error",
          message: "files.glob() requires relative patterns that stay inside their base.",
        });
      }
      const directory = resolve(base ?? ".");
      const options: GlobOptions = { ...loaderOptions, base: directory };
      dependencies.push({ kind: "glob", base: directory, options });
      const entries = await loadGlob({ kind: "glob", options }, root, signal, { warnEmpty: false });
      const retained = loaderOptions.retainBody !== false;
      return Promise.all(
        entries.map((value) => {
          dependencies.push({ kind: "file", path: value.source! });
          return entryOf(
            schema,
            { ...value, body: retained ? value.body : undefined },
            value.sourceData!.filePath,
          );
        }),
      );
    },
    async file(filePath, fileOptions = {}) {
      const { schema, ...loaderOptions } = fileOptions;
      const resolved = resolve(filePath);
      dependencies.push({ kind: "file", path: resolved });
      const descriptor = { kind: "file" as const, filename: resolved, options: loaderOptions };
      const entries = await loadFile(descriptor, root, signal);
      const relative = path.relative(root, builtinPath(descriptor, root)).split(path.sep).join("/");
      return Promise.all(entries.map((value) => entryOf(schema, value, relative)));
    },
    text(filePath) {
      return read(filePath, (resolved) => readFile(resolved, { encoding: "utf8", signal }));
    },
    bytes(filePath) {
      return read(
        filePath,
        async (resolved) => new Uint8Array(await readFile(resolved, { signal })),
      );
    },
    async renderMarkdown(body) {
      const { html, headings } = await renderMarkdown(body);
      return { html, metadata: { headings } };
    },
  };
}
