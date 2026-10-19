import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm, rmdir, link } from "node:fs/promises";
import { renameSync } from "node:fs";
import path from "node:path";
import type { PreparedRevision } from "../runtime/revision.ts";
import { ContentError } from "../shared/errors.ts";
import { revisionModules } from "./modules.ts";
import { contentDeclarations, virtualDeclarations } from "./declarations.ts";

/** Writes changed bytes only, keeping unchanged importer targets stable. */
export async function writeChanged(
  filename: string,
  source: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    if ((await readFile(filename, "utf8")) === source) {
      return;
    }
  } catch {
    /* New artifact. */
  }
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, source);
  try {
    signal?.throwIfAborted();
    renameSync(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Publishes a complete immutable module without overwriting any earlier revision's bytes. */
async function writeImmutable(filename: string, source: string): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, source);
  try {
    try {
      await link(temporary, filename);
    } catch (cause) {
      if (!cause || typeof cause !== "object" || !("code" in cause) || cause.code !== "EEXIST") {
        throw cause;
      }
      if ((await readFile(filename, "utf8")) !== source) {
        throw new ContentError({
          code: "artifact-error",
          operation: "build",
          source: filename,
          message:
            "An immutable artifact key has conflicting bytes. Regenerate the output directory.",
          cause,
        });
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

const immutableModule = /\/(?:entries\/[a-f0-9]{64}|index-[a-f0-9]{64})\.js$/;

/** Lists one directory's entries, treating a missing directory or a file as empty. */
async function entriesOf(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    // Missing directories and stray files, such as .DS_Store, contain no generated modules.
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw cause;
  }
}

/** Removes a directory only when nothing else remains in it. */
async function removeIfEmpty(directory: string): Promise<void> {
  try {
    await rmdir(directory);
  } catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (!["ENOTEMPTY", "EEXIST", "ENOENT", "ENOTDIR"].includes(String(code))) {
      throw cause;
    }
  }
}

/**
 * Deletes generated collection modules the published revision no longer references. Only
 * library-named files are removed, so unrelated files in the output directory survive.
 */
async function pruneArtifacts(outDir: string, modules: ReadonlyMap<string, string>): Promise<void> {
  const collections = path.join(outDir, "collections");
  for (const directory of await entriesOf(collections)) {
    const owned = path.join(collections, directory);
    const entries = path.join(owned, "entries");
    const candidates = [
      ...(await entriesOf(owned)).map((name) => `collections/${directory}/${name}`),
      ...(await entriesOf(entries)).map((name) => `collections/${directory}/entries/${name}`),
    ];
    for (const filename of candidates) {
      const generated =
        immutableModule.test(`/${filename}`) || filename.endsWith(`/${directory}/index.js`);
      if (generated && !modules.has(filename)) {
        await rm(path.join(outDir, filename), { force: true });
      }
    }
    await removeIfEmpty(entries);
    await removeIfEmpty(owned);
  }
}

export type WriteArtifactsOptions = {
  signal?: AbortSignal;
  /** Remove superseded modules; only safe when no earlier revision can still be loading. */
  prune?: boolean;
};

/** Stages immutable modules before atomically switching the public server entry. */
export async function writeArtifacts(
  revision: PreparedRevision,
  outDir: string,
  config: string,
  { signal, prune = false }: WriteArtifactsOptions = {},
): Promise<void> {
  const modules = await revisionModules(revision);
  await writeChanged(path.join(outDir, "package.json"), '{"type":"module","private":true}\n');
  await writeChanged(path.join(outDir, "server.d.ts"), contentDeclarations(outDir, config));
  await writeChanged(path.join(outDir, "types.d.ts"), virtualDeclarations(outDir, config));
  for (const [filename, code] of modules) {
    if (filename !== "server.js") {
      if (immutableModule.test(`/${filename}`)) {
        await writeImmutable(path.join(outDir, filename), code);
      } else {
        await writeChanged(path.join(outDir, filename), code);
      }
    }
  }
  await writeChanged(path.join(outDir, "server.js"), modules.get("server.js")!, signal);
  // Watch sessions keep superseded modules for operations pinned to earlier revisions.
  if (prune) {
    await pruneArtifacts(outDir, modules);
  }
}
