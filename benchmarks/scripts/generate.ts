import { createHash } from "node:crypto";
import { copyFile, link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { apps, appDirectory, benchmarkRoot, defaultEntries } from "./config.ts";

export type Corpus = {
  entries: number;
  bytes: number;
  sha256: string;
  hardlinks: number;
  copies: number;
};

/** Produces stable identities without numeric prefixes that Nuxt interprets as ordering syntax. */
export function entryNumber(order: number): string {
  return String(order).padStart(5, "0");
}

/** Generates approximately one KB of plain Markdown with unique metadata and body markers. */
export function entrySource(order: number): string {
  const number = entryNumber(order);
  return `---\ntitle: Benchmark entry ${number}\ndescription: A deterministic content benchmark document ${number}.\norder: ${order}\n---\n\n## Benchmark article ${number}\n\nDataset marker entry-${number}. This document belongs to the shared benchmark corpus. Its metadata and body are unique, so each application must discover, validate, and process a real collection of separate entries.\n\n### Working with content\n\nA content system connects authored documents to an application. This paragraph exercises ordinary Markdown without images, external requests, framework components, or syntax highlighting. **Consistent inputs** make startup and production build measurements easier to reproduce.\n\n- Load and validate the frontmatter.\n- Preserve the authored document structure.\n- Render the selected article using the native content integration.\n\nRead the [benchmark reference](https://example.com/benchmark) for an example link. The index lists every title and description with a link to its dedicated article page. Every article is prerendered during the production build.\n`;
}

/** Shares an entry's inode when supported, copying only for filesystem capability errors. */
export async function linkOrCopy(
  source: string,
  destination: string,
  linkFile: typeof link = link,
): Promise<"hardlink" | "copy"> {
  try {
    await linkFile(source, destination);
    return "hardlink";
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP"].includes(code ?? "")) {
      throw cause;
    }
    await copyFile(source, destination);
    return "copy";
  }
}

/** Recreates only generated corpus directories, sharing identical entries across every app. */
export async function generateCorpus(
  root = benchmarkRoot,
  count = defaultEntries,
): Promise<Corpus> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) {
    throw new Error("Entry count must be an integer between 1 and 100000.");
  }
  const canonical = path.join(root, ".fixtures", "entries");
  const destinations = apps.map((app) => path.join(appDirectory(root, app), "content", "entries"));
  for (const directory of [canonical, ...destinations]) {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
  }
  const hash = createHash("sha256");
  const corpus: Corpus = { entries: count, bytes: 0, sha256: "", hardlinks: 0, copies: 0 };
  for (let offset = 0; offset < count; offset += 64) {
    const batch = Array.from({ length: Math.min(64, count - offset) }, (_, index) => {
      const order = offset + index + 1;
      const filename = `entry-${entryNumber(order)}.md`;
      const source = entrySource(order);
      hash.update(filename).update("\0").update(source).update("\0");
      corpus.bytes += Buffer.byteLength(source);
      return { filename, source };
    });
    await Promise.all(
      batch.map(async ({ filename, source }) => {
        const original = path.join(canonical, filename);
        await writeFile(original, source);
        for (const destination of destinations) {
          const mode = await linkOrCopy(original, path.join(destination, filename));
          if (mode === "hardlink") {
            corpus.hardlinks++;
          } else {
            corpus.copies++;
          }
        }
      }),
    );
  }
  corpus.sha256 = hash.digest("hex");
  await writeFile(
    path.join(root, ".fixtures", "manifest.json"),
    `${JSON.stringify(corpus, null, 2)}\n`,
  );
  return corpus;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { entries: { type: "string", default: String(defaultEntries) } },
  });
  console.log(await generateCorpus(benchmarkRoot, Number(values.entries)));
}
