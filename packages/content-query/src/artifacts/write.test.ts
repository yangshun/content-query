import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { PreparedRevision } from "../runtime/revision.ts";
import { writeArtifacts } from "./write.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

/** Creates several payloads to exercise publication without loading an application config. */
function revision(): PreparedRevision {
  return {
    collections: {
      posts: {
        records: Array.from({ length: 24 }, (_, index) => ({ id: String(index) })),
        payloads: new Map(
          Array.from({ length: 24 }, (_, index) => [
            String(index),
            async () => ({ body: `Article ${index}` }),
          ]),
        ),
        relationships: {},
        sources: new Map(),
      },
    },
    registry: { posts: { relationships: {} } },
    relations: new Map(),
    active: 0,
    payloadCache: new Map(),
    renderCache: new Map(),
    renderMarkdown: async () => ({ html: "", headings: [] }),
  };
}

describe("artifact publication", () => {
  test("reuses unchanged immutable files without staging new writes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "content-query-artifact-writes-"));
    const prepared = revision();
    const config = path.join(directory, "content-query.config.ts");
    const entries = path.join(directory, "collections/posts/entries");
    const write = vi.mocked(filesystem.writeFile);
    try {
      await writeArtifacts(prepared, directory, config);
      const filenames = await readdir(entries);
      const before = await Promise.all(
        filenames.map((filename) => stat(path.join(entries, filename))),
      );
      write.mockClear();
      await writeArtifacts(prepared, directory, config);
      expect(write).not.toHaveBeenCalled();
      const after = await Promise.all(
        filenames.map((filename) => stat(path.join(entries, filename))),
      );
      expect(after.map(({ ino, mtimeMs }) => ({ ino, mtimeMs }))).toEqual(
        before.map(({ ino, mtimeMs }) => ({ ino, mtimeMs })),
      );
    } finally {
      write.mockClear();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("retains conflicting immutable bytes and never switches the public entry on failure", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "content-query-artifact-conflict-"));
    const prepared = revision();
    const config = path.join(directory, "content-query.config.ts");
    try {
      await writeArtifacts(prepared, directory, config);
      const entries = path.join(directory, "collections/posts/entries");
      await writeFile(path.join(entries, (await readdir(entries))[0]!), "Corrupted immutable file");
      await writeFile(path.join(directory, "server.js"), "Previous public entry");
      await expect(writeArtifacts(prepared, directory, config)).rejects.toMatchObject({
        code: "artifact-error",
      });
      expect(await filesystem.readFile(path.join(directory, "server.js"), "utf8")).toBe(
        "Previous public entry",
      );
      expect((await readdir(entries)).some((filename) => filename.includes(".tmp-"))).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
