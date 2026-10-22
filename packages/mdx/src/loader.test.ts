import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { LoaderContext, FileSource, DataEntry } from "content-query/loaders";
import { describe, expect, test, vi } from "vite-plus/test";
import { mdx, readMdx } from "./loader.ts";

describe("MDX local loader", () => {
  test("captures source metadata and responds to additions, edits, removals, and recovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cq-mdx-loader-"));
    const directory = path.join(root, "guides");
    await mkdir(path.join(directory, "nested"), { recursive: true });
    const store = new Map<string, DataEntry>();
    let notify: (event: string, filename: string) => Promise<void>;
    const watcher = {
      add: vi.fn(),
      on: (_event: string, callback: typeof notify) => {
        notify = callback;
      },
    };
    const parseData = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (typeof data.title !== "string") {
        throw new Error("title required");
      }
      return data;
    });
    const context = {
      config: { root: pathToFileURL(`${root}/`) },
      store: { clear: () => store.clear(), set: (entry: DataEntry) => store.set(entry.id, entry) },
      parseData,
      generateDigest: (text: string) => text,
      watcher,
    } as unknown as LoaderContext<FileSource>;
    try {
      await writeFile(
        path.join(directory, "nested/index.mdx"),
        "---\ntitle: Nested\n---\n\n# Body\n",
      );
      await mdx({ base: "guides" }).load(context);
      expect([...store.keys()]).toEqual(["nested"]);
      expect(store.get("nested")).toMatchObject({
        body: "# Body\n",
        filePath: path.join(directory, "nested/index.mdx"),
        source: { filePath: "guides/nested/index.mdx" },
      });
      await writeFile(
        path.join(directory, "other.mdx"),
        "---\ntitle: Other\nslug: custom\n---\n# Other",
      );
      await notify!("add", path.join(directory, "other.mdx"));
      expect(store.has("custom")).toBe(true);
      await writeFile(
        path.join(directory, "other.mdx"),
        "---\ntitle: Edited\nslug: custom\n---\n# Edited",
      );
      await notify!("change", path.join(directory, "other.mdx"));
      expect(store.get("custom")?.data.title).toBe("Edited");
      await writeFile(path.join(directory, "other.mdx"), "# Invalid metadata");
      await expect(notify!("change", path.join(directory, "other.mdx"))).rejects.toThrow(
        "title required",
      );
      expect(store.get("custom")?.data.title).toBe("Edited");
      await rm(path.join(directory, "other.mdx"));
      await notify!("unlink", path.join(directory, "other.mdx"));
      expect([...store.keys()]).toEqual(["nested"]);
      const before = parseData.mock.calls.length;
      await notify!("change", path.join(root, "unrelated.mdx"));
      expect(parseData).toHaveBeenCalledTimes(before);
      const custom = mdx({
        base: pathToFileURL(`${directory}/`),
        generateId: ({ entry }) => `custom/${entry}`,
      });
      await custom.load({ ...context, watcher: undefined });
      expect(store.has("custom/nested/index.mdx")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("reports invalid options and duplicate or invalid IDs", async () => {
    expect(() => mdx({ base: "" })).toThrow("base directory");
    expect(readMdx("---\ntitle: Value\n---\n\nText")).toEqual({
      data: { title: "Value" },
      body: "Text",
    });
    expect(() => readMdx("---\n- item\n---\nText")).toThrow("record");
    const root = await mkdtemp(path.join(os.tmpdir(), "cq-mdx-identity-"));
    try {
      await writeFile(path.join(root, "one.mdx"), "---\ntitle: One\n---\n");
      await writeFile(path.join(root, "two.mdx"), "---\ntitle: Two\n---\n");
      const context = {
        config: { root: pathToFileURL(`${root}/`) },
        parseData: async ({ data }: { data: Record<string, unknown> }) => data,
        generateDigest: () => "hash",
      } as unknown as LoaderContext<FileSource>;
      await expect(mdx({ base: ".", generateId: () => "same" }).load(context)).rejects.toThrow(
        "duplicate",
      );
      await expect(mdx({ base: ".", generateId: () => "" }).load(context)).rejects.toThrow(
        "Invalid",
      );
      await writeFile(path.join(root, "one.mdx"), "---\nslug: { invalid: true }\n---\n");
      await expect(mdx({ base: "." }).load(context)).rejects.toThrow("slug must be");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
