import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { populateStore } from "./populate.ts";
import {
  ContentError,
  contentError,
  describeCause,
  groupDiagnostics,
  type ContentDiagnostic,
} from "../shared/errors.ts";
import { builtinPath, builtinSymbol, type BuiltinLoader, type MarkedLoader } from "./descriptor.ts";
import type { FileEntrySource, Loader, LoaderEntry } from "./types.ts";
import type { FileOptions } from "./descriptor.ts";
import { parseData, recordData, coerceIdentity } from "./parse.ts";

/** Declares a multi-entry data file with typed source paths and record keys, plus an optional parser. */
export function file(filename: string, options: FileOptions = {}): Loader<FileEntrySource> {
  if (typeof filename !== "string" || !filename) {
    throw new TypeError("file() requires a filename.");
  }
  const descriptor: BuiltinLoader = { kind: "file", filename, options };
  return {
    [builtinSymbol]: descriptor,
    name: "content-query/file",
    async load(context) {
      const entries = await loadFile(
        descriptor,
        fileURLToPath(context.config.root),
        context.signal ?? new AbortController().signal,
      );
      await populateStore(context, entries);
    },
  } as MarkedLoader<FileEntrySource>;
}

/** Captures a complete multi-entry data source without applying collection validation. */
export async function loadFile(
  descriptor: Extract<BuiltinLoader, { kind: "file" }>,
  root: string,
  signal: AbortSignal,
): Promise<LoaderEntry<FileEntrySource>[]> {
  const resolved = builtinPath(descriptor, root);
  let parsed: unknown;
  try {
    const text = await readFile(resolved, { encoding: "utf8", signal });
    parsed = descriptor.options.parser
      ? await descriptor.options.parser(text)
      : parseData(text, resolved);
  } catch (cause) {
    signal.throwIfAborted();
    throw contentError(cause, {
      code: "source-error",
      source: resolved,
      message: `Could not load "${descriptor.filename}": ${describeCause(cause)}`,
      cause,
    });
  }
  const array = Array.isArray(parsed);
  if (!array && (!parsed || typeof parsed !== "object")) {
    throw new ContentError({
      code: "source-error",
      source: resolved,
      message: `"${descriptor.filename}" must parse to an array or keyed record.`,
    });
  }
  const diagnostics: ContentDiagnostic[] = [];
  const entries = Object.entries(parsed as object).flatMap(([key, value]) => {
    if (!array && key === "$schema" && typeof value === "string") {
      return [];
    }
    const source = `${resolved}#${key}`;
    try {
      const data = recordData(value);
      const identity = array ? (data.id ?? data.slug) : key;
      if (identity == null || coerceIdentity(identity) === "") {
        throw new Error("Array entries require a nonempty id or slug.");
      }
      const { id: _transportId, ...metadata } = data;
      return [
        {
          id: coerceIdentity(identity),
          data: metadata,
          source: array ? source : `${resolved}#${coerceIdentity(identity)}`,
          sourceData: {
            filePath: path.relative(root, resolved).split(path.sep).join("/"),
            key,
          },
        },
      ];
    } catch (cause) {
      diagnostics.push({
        code: "source-error",
        source,
        message: `Invalid entry "${key}" in "${descriptor.filename}": ${describeCause(cause)}`,
        cause,
      });
      return [];
    }
  });
  if (diagnostics.length) {
    throw groupDiagnostics(diagnostics);
  }
  return entries;
}
