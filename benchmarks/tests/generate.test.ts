import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { apps, appDirectory } from "../scripts/config.ts";
import { entrySource, generateCorpus, linkOrCopy } from "../scripts/generate.ts";

const temporary: string[] = [];
async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "content-query-corpus-"));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("shared corpus generation", () => {
  test("creates deterministic unique documents with identical hardlinked app inputs", async () => {
    const root = await temporaryDirectory();
    const manifest = await generateCorpus(root, 4);
    expect(manifest.entries).toBe(4);
    expect(manifest.hardlinks).toBe(4 * apps.length);
    expect(manifest.copies).toBe(0);
    expect(manifest.bytes).toBeGreaterThan(4_000);
    const canonical = path.join(root, ".fixtures/entries");
    const filenames = await readdir(canonical);
    expect(filenames).toHaveLength(4);
    const sources = await Promise.all(
      filenames.map((filename) => readFile(path.join(canonical, filename), "utf8")),
    );
    expect(new Set(sources).size).toBe(4);
    for (const app of apps) {
      for (const filename of filenames) {
        const source = path.join(canonical, filename);
        const destination = path.join(appDirectory(root, app), "content/entries", filename);
        expect(await readFile(destination, "utf8")).toBe(await readFile(source, "utf8"));
        expect((await stat(destination)).ino).toBe((await stat(source)).ino);
      }
    }
    const regenerated = await generateCorpus(root, 4);
    expect(regenerated).toEqual(manifest);
    await generateCorpus(root, 2);
    expect(await readdir(canonical)).toHaveLength(2);
    for (const app of apps) {
      expect(await readdir(path.join(appDirectory(root, app), "content/entries"))).toHaveLength(2);
    }
  });

  test("keeps the documented Markdown payload close to one KB", () => {
    expect(Buffer.byteLength(entrySource(10_000))).toBeGreaterThan(1_000);
    expect(Buffer.byteLength(entrySource(10_000))).toBeLessThan(1_200);
    expect(entrySource(10_000)).toContain("Dataset marker entry-10000.");
  });

  test.each([0, -1, 1.5, Number.NaN, 100_001])("rejects invalid entry count %s", async (count) => {
    await expect(generateCorpus(await temporaryDirectory(), count)).rejects.toThrow("Entry count");
  });
});

describe("hardlink fallback", () => {
  test("copies an entry when the destination is on another filesystem", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "source.md");
    const destination = path.join(root, "copy.md");
    await writeFile(source, "Example document");
    const mode = await linkOrCopy(source, destination, async () => {
      throw Object.assign(new Error("Cross-device link"), { code: "EXDEV" });
    });
    expect(mode).toBe("copy");
    expect(await readFile(destination, "utf8")).toBe("Example document");
    expect((await stat(destination)).ino).not.toBe((await stat(source)).ino);
  });

  test("preserves unexpected filesystem failures", async () => {
    const failure = Object.assign(new Error("No space"), { code: "ENOSPC" });
    await expect(
      linkOrCopy("source", "destination", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});
