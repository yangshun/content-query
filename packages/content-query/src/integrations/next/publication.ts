import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { contentDeclarations } from "../../artifacts/declarations.ts";
import { serializeContentError } from "../../runtime/diagnostics.ts";
import type { ContentState } from "../../runtime/revision.ts";

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

/** Publishes fresh runtime imports and optionally prunes previous runs after a successful build. */
export function publishDevelopment(
  outDir: string,
  config: string,
  state: ContentState,
  { prune = false }: { prune?: boolean } = {},
): string | undefined {
  if (!state.error) {
    if (!state.revision) {
      return undefined;
    }
    const entry = path.join(outDir, "server.js");
    const filename = `next-dev-${randomUUID()}.js`;
    const runtime = path.join(outDir, filename);
    writeEntry(runtime, readFileSync(entry, "utf8"));
    writeEntry(entry, `export { content } from ${JSON.stringify(`./${filename}`)};\n`);
    if (prune) {
      pruneDevelopmentEntries(outDir, filename);
    }
    return runtime;
  }
  writeEntry(path.join(outDir, "package.json"), '{"type":"module","private":true}\n');
  writeEntry(path.join(outDir, "server.d.ts"), contentDeclarations(outDir, config));
  writeEntry(
    path.join(outDir, "server.js"),
    `import { restoreContentError } from "content-query/internal";\nthrow restoreContentError(${JSON.stringify(serializeContentError(state.error))});\nexport const content = undefined;\n`,
  );
  return undefined;
}

/** Removes owned runtime entries from previous runs, preserving the current facade's target. */
export function pruneDevelopmentEntries(outDir: string, keep?: string): void {
  for (const filename of readdirSync(outDir)) {
    if (
      filename !== keep &&
      /^next-dev-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.js$/.test(filename)
    ) {
      rmSync(path.join(outDir, filename), { force: true });
    }
  }
}
