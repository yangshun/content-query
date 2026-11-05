import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { collectionDeclarations } from "../../artifacts/declarations.ts";
import { collectionNames } from "../../collection/names.ts";
import { serializeContentError } from "../../runtime/diagnostics.ts";
import type { ContentState } from "../../runtime/revision.ts";

const developmentEntry = /^next-dev-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.js$/;

/** Switches a development entry synchronously so error delivery cannot race a later publication. */
function writeEntry(filename: string, source: string): void {
  try {
    if (readFileSync(filename, "utf8") === source) {
      return;
    }
  } catch {
    // The first content attempt can fail before artifacts exist.
  }
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, source);
    renameSync(temporary, filename);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Lists one directory's entries, treating a missing directory as empty. */
function entriesOf(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw cause;
  }
}

/** Lists the directories of collection entries that exist from an earlier publication. */
function publishedCollections(outDir: string): string[] {
  const collections = path.join(outDir, "collections");
  return entriesOf(collections)
    .map((name) => path.join(collections, name))
    .filter((directory) => existsSync(path.join(directory, "server.js")));
}

/** Points one entry at a fresh copy of its runtime, so Next reloads it even for identical bytes. */
function redirectEntry(directory: string, exportName: string, filename: string): string {
  const entry = path.join(directory, "server.js");
  const runtime = path.join(directory, filename);
  writeEntry(runtime, readFileSync(entry, "utf8"));
  writeEntry(entry, `export { ${exportName} } from ${JSON.stringify(`./${filename}`)};\n`);
  return runtime;
}

/**
 * Publishes fresh runtime imports and optionally prunes previous runs after a successful build.
 *
 * Each collection entry, `collections/<export name>/server.js`, is pointed at a fresh copy of its
 * runtime. A preparation error replaces every entry, so each route that imports one reports it.
 *
 * @param outDir - Generated output directory.
 * @param config - Absolute path of content-query.config.
 * @param state - The session's current revision or error.
 * @param options - `prune` removes development entries from previous runs.
 * @returns The new runtime modules, or `undefined` when nothing valid was published.
 */
export function publishDevelopment(
  outDir: string,
  config: string,
  state: ContentState,
  { prune = false }: { prune?: boolean } = {},
): string[] | undefined {
  if (!state.error) {
    if (!state.revision) {
      return undefined;
    }
    const filename = `next-dev-${randomUUID()}.js`;
    const runtimes = [...collectionNames(state.revision.registry).values()].map(({ exportName }) =>
      redirectEntry(path.join(outDir, "collections", exportName), exportName, filename),
    );
    if (prune) {
      pruneDevelopmentEntries(outDir, filename);
    }
    return runtimes;
  }
  // Each failing entry still declares its export, so bundlers resolve the import and the error throws.
  const failure = `import { restoreContentError } from "content-query/internal";\nthrow restoreContentError(${JSON.stringify(serializeContentError(state.error))});\n`;
  const directories = new Map(
    publishedCollections(outDir).map((directory) => [directory, path.basename(directory)]),
  );
  for (const [name, generated] of collectionNames(state.registry ?? {})) {
    const directory = path.join(outDir, "collections", generated.exportName);
    directories.set(directory, generated.exportName);
    writeEntry(
      path.join(directory, "server.d.ts"),
      collectionDeclarations(directory, config, name, generated),
    );
  }
  writeEntry(path.join(outDir, "package.json"), '{"type":"module","private":true}\n');
  for (const [directory, exportName] of directories) {
    writeEntry(
      path.join(directory, "server.js"),
      `${failure}export const ${exportName} = undefined;\n`,
    );
  }
  return undefined;
}

/**
 * Removes owned runtime entries from previous runs, preserving the current entries' target.
 *
 * @param outDir - Generated output directory.
 * @param keep - The current publication's runtime filename, shared by every entry.
 */
export function pruneDevelopmentEntries(outDir: string, keep?: string): void {
  const collections = path.join(outDir, "collections");
  const directories = [
    outDir,
    ...entriesOf(collections).map((name) => path.join(collections, name)),
  ];
  for (const directory of directories) {
    const entries = entriesOf(directory);
    for (const filename of entries) {
      if (filename !== keep && developmentEntry.test(filename)) {
        rmSync(path.join(directory, filename), { force: true });
      }
    }
    if (directory !== outDir && entries.every((filename) => developmentEntry.test(filename))) {
      // A removed collection's directory can hold only development entries after pruning.
      try {
        rmdirSync(directory);
      } catch {
        // It still holds the kept entry, or another process added a file.
      }
    }
  }
}
