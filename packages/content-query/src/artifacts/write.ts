import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rm, rmdir, link } from "node:fs/promises";
import { renameSync } from "node:fs";
import path from "node:path";
import type { PreparedRevision } from "../runtime/revision.ts";
import { ContentError } from "../shared/errors.ts";
import { collectionNames } from "../collection/names.ts";
import { revisionModules } from "./modules.ts";
import { collectionDeclarations, virtualDeclarations } from "./declarations.ts";

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

/** Checks reusable immutable bytes, retaining corruption diagnostics instead of overwriting them. */
async function existingImmutable(filename: string, source: string): Promise<boolean> {
  let existing: string;
  try {
    existing = await readFile(filename, "utf8");
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      return false;
    }
    throw cause;
  }
  if (existing !== source) {
    throw new ContentError({
      code: "artifact-error",
      operation: "build",
      source: filename,
      message: "An immutable artifact key has conflicting bytes. Regenerate the output directory.",
    });
  }
  return true;
}

/** Publishes into an existing directory without rewriting an earlier revision's immutable bytes. */
async function writeImmutable(filename: string, source: string): Promise<void> {
  if (await existingImmutable(filename, source)) {
    return;
  }
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, source);
  try {
    try {
      await link(temporary, filename);
    } catch (cause) {
      if (!cause || typeof cause !== "object" || !("code" in cause) || cause.code !== "EEXIST") {
        throw cause;
      }
      if (!(await existingImmutable(filename, source))) {
        throw cause;
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

const immutableModule =
  /\/(?:entries\/[a-f0-9]{64}|payloads\/[^/]+\/[a-f0-9]{64}|index-[a-f0-9]{64})\.js$/;
/** Matches each collection's entry, which imports the collection's other modules. */
const collectionEntry = /^collections\/[^/]+\/server\.js$/;

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
    const payloads = path.join(owned, "payloads");
    const payloadDirectories = await entriesOf(payloads);
    const candidates = [
      ...(await entriesOf(owned)).map((name) => `collections/${directory}/${name}`),
      ...(await entriesOf(entries)).map((name) => `collections/${directory}/entries/${name}`),
    ];
    for (const payload of payloadDirectories) {
      candidates.push(
        ...(await entriesOf(path.join(payloads, payload))).map(
          (name) => `collections/${directory}/payloads/${payload}/${name}`,
        ),
      );
    }
    for (const filename of candidates) {
      const generated =
        immutableModule.test(`/${filename}`) || filename.endsWith(`/${directory}/server.js`);
      // A collection entry's declarations go when its entry does.
      const declarations =
        filename.endsWith(`/${directory}/server.d.ts`) &&
        !modules.has(filename.replace(/\.d\.ts$/, ".js"));
      if ((generated && !modules.has(filename)) || declarations) {
        await rm(path.join(outDir, filename), { force: true });
      }
    }
    await removeIfEmpty(entries);
    for (const payload of payloadDirectories) {
      await removeIfEmpty(path.join(payloads, payload));
    }
    await removeIfEmpty(payloads);
    await removeIfEmpty(owned);
  }
}

export type WriteArtifactsOptions = {
  signal?: AbortSignal;
  /** Remove superseded modules; only safe when no earlier revision can still be loading. */
  prune?: boolean;
};

/**
 * Stages modules with bounded I/O before switching each collection's public entry.
 *
 * @param revision - The prepared revision to publish.
 * @param outDir - The generated output directory.
 * @param config - Absolute path of content-query.config, which declarations import types from.
 * @param options - `signal` cancels the write; `prune` removes superseded modules.
 */
export async function writeArtifacts(
  revision: PreparedRevision,
  outDir: string,
  config: string,
  { signal, prune = false }: WriteArtifactsOptions = {},
): Promise<void> {
  const modules = await revisionModules(revision);
  const names = collectionNames(revision.registry);
  await writeChanged(path.join(outDir, "package.json"), '{"type":"module","private":true}\n');
  await writeChanged(path.join(outDir, "types.d.ts"), virtualDeclarations(outDir, config, names));
  for (const [name, generated] of names) {
    const directory = path.join(outDir, "collections", generated.exportName);
    await writeChanged(
      path.join(directory, "server.d.ts"),
      collectionDeclarations(directory, config, name, generated),
    );
  }
  // Entries import the other modules, so they switch only after every module they import exists.
  const staged = [...modules].filter(([filename]) => !collectionEntry.test(filename));
  const directories = new Set(
    staged.map(([filename]) => path.dirname(path.join(outDir, filename))),
  );
  await Promise.all(
    [...directories].map(async (directory) => mkdir(directory, { recursive: true })),
  );
  const pending = staged.values();
  const outcomes = await Promise.allSettled(
    Array.from({ length: Math.min(16, staged.length) }, async () => {
      for (const [filename, code] of pending) {
        signal?.throwIfAborted();
        if (immutableModule.test(`/${filename}`)) {
          await writeImmutable(path.join(outDir, filename), code);
        } else {
          await writeChanged(path.join(outDir, filename), code);
        }
      }
    }),
  );
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
  for (const [filename, code] of modules) {
    if (collectionEntry.test(filename)) {
      await writeChanged(path.join(outDir, filename), code, signal);
    }
  }
  // Watch sessions keep superseded modules for operations pinned to earlier revisions.
  if (prune) {
    await pruneArtifacts(outDir, modules);
  }
}
