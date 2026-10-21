import * as filesystem from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { loadGlob } from "./glob.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: vi.fn(original.readFile) };
});

describe("glob source acquisition", () => {
  test("bounds outstanding reads while preserving sorted complete snapshots", async () => {
    const root = await filesystem.mkdtemp(path.join(os.tmpdir(), "content-query-glob-capacity-"));
    const original = await vi.importActual<typeof filesystem>("node:fs/promises");
    const read = vi.mocked(filesystem.readFile);
    let active = 0;
    let peak = 0;
    read.mockImplementation(async (filename, options) => {
      active++;
      peak = Math.max(peak, active);
      try {
        return await original.readFile(filename, options);
      } finally {
        active--;
      }
    });
    try {
      await Promise.all(
        Array.from({ length: 128 }, (_, index) =>
          filesystem.writeFile(
            path.join(root, `entry-${String(index).padStart(3, "0")}.md`),
            `---\ntitle: Article ${index}\n---\nBody ${index}\n`,
          ),
        ),
      );
      const entries = await loadGlob(
        { kind: "glob", options: { pattern: "*.md" } },
        root,
        new AbortController().signal,
      );
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(64);
      expect(active).toBe(0);
      expect(entries).toHaveLength(128);
      expect(entries.map((entry) => entry.id)).toEqual(
        Array.from({ length: 128 }, (_, index) => `entry-${String(index).padStart(3, "0")}`),
      );
      expect(entries[127]).toMatchObject({ data: { title: "Article 127" }, body: "Body 127\n" });
    } finally {
      read.mockReset();
      read.mockImplementation(original.readFile);
      await filesystem.rm(root, { recursive: true, force: true });
    }
  });
});
