import { collectLoader } from "../../tests/helpers/loader.ts";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { file, glob } from "../loaders.ts";
import { builtinLoader } from "./descriptor.ts";
import { loadBuiltin } from "./load.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { defineCollection } from "../collection/define.ts";

describe("built-in loaders", () => {
  test("establishes external source watching before loading the initial snapshot", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-app-root-"));
    const external = await mkdtemp(path.join(os.tmpdir(), "content-query-external-"));
    const registry = {
      posts: defineCollection({
        loader: glob({ base: pathToFileURL(external + path.sep), pattern: "*.md" }),
        schema: z.object({ title: z.string() }),
      }),
    };
    await writeFile(path.join(external, "post.md"), "---\ntitle: External\n---\n");
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    try {
      expect(await session.content.query("posts").select("title").first()).toEqual({
        title: "External",
      });
      await writeFile(path.join(external, "post.md"), "---\ntitle: Changed outside root\n---\n");
      await vi.waitFor(async () =>
        expect(await session.content.query("posts").select("title").first()).toEqual({
          title: "Changed outside root",
        }),
      );
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
      await rm(external, { recursive: true, force: true });
    }
  });
  test("glob preserves captures while applying Astro IDs, exclusions, and custom generation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-glob-"));
    try {
      await mkdir(path.join(root, "Guides"));
      await writeFile(
        path.join(root, "Getting Started.md"),
        "---\ntitle: Start\n---\n\n  \nBody\n\n    indented\n",
      );
      await writeFile(path.join(root, "Guides/index.md"), "---\nslug: custom/path\n---\nGuide\n");
      await writeFile(path.join(root, "Guides/Overview.md"), "## Overview\n");
      await writeFile(path.join(root, "index.md"), "Root\n");
      await writeFile(path.join(root, "ignored.md"), "Ignore\n");
      const descriptor = builtinLoader(
        glob({ pattern: ["**/*.md", "!ignored.md"], base: pathToFileURL(root + path.sep) }),
      )!;
      const entries = await loadBuiltin(descriptor, "/unrelated", new AbortController().signal);
      expect(entries.map((entry) => entry.id).sort()).toEqual([
        "custom/path",
        "getting-started",
        "guides/overview",
        "index",
      ]);
      expect(entries.find((entry) => entry.id === "getting-started")).toMatchObject({
        data: { title: "Start" },
        body: "Body\n\n    indented\n",
      });
      const custom = glob({
        pattern: "**/*.md",
        base: root,
        generateId: ({ entry, base }) => {
          expect(base).toBeInstanceOf(URL);
          return entry;
        },
      });
      expect((await collectLoader(custom)).some((entry) => entry.id === "Getting Started.md")).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  for (const [extension, source] of [
    ["json", '{"$schema":"https://example.com/schema","ada":{"id":"ignored","name":"Ada"}}'],
    ["yaml", "ada:\n  id: ignored\n  name: Ada\n"],
    ["toml", '[ada]\nid = "ignored"\nname = "Ada"\n'],
  ]) {
    test(`file parses keyed ${extension}, consumes transport IDs, and has no implicit body`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "content-query-file-"));
      try {
        await writeFile(path.join(root, `authors.${extension}`), source!);
        const entries = await loadBuiltin(
          builtinLoader(file(`./authors.${extension}`))!,
          root,
          new AbortController().signal,
        );
        expect(entries).toEqual([
          { id: "ada", data: { name: "Ada" }, source: expect.stringContaining("authors.") },
        ]);
        expect(entries[0]).not.toHaveProperty("body");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
  test("file supports nullish slug fallback, normalization, and asynchronous custom parsers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-parser-"));
    try {
      await writeFile(
        path.join(root, "team.custom"),
        '{"authors":[{"id":null,"slug":"ada","name":"Ada"},{"id":2,"name":"Grace"}]}',
      );
      const descriptor = builtinLoader(
        file("team.custom", { parser: async (text) => JSON.parse(text).authors }),
      )!;
      const entries = await loadBuiltin(descriptor, root, new AbortController().signal);
      expect(entries.map((entry) => ({ id: entry.id, data: entry.data }))).toEqual([
        { id: "ada", data: { slug: "ada", name: "Ada" } },
        { id: "2", data: { name: "Grace" } },
      ]);
      await writeFile(path.join(root, "bad.json"), '[{"name":"Missing ID"}, 1]');
      await expect(
        loadBuiltin(builtinLoader(file("bad.json"))!, root, new AbortController().signal),
      ).rejects.toMatchObject({
        code: "source-error",
        diagnostics: [
          expect.objectContaining({
            source: `${path.join(root, "bad.json")}#0`,
            message: expect.stringMatching(/nonempty/),
          }),
          expect.objectContaining({
            source: `${path.join(root, "bad.json")}#1`,
            message: expect.stringMatching(/must be a record/),
          }),
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("reports every unreadable source with its file and parser detail", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-broken-sources-"));
    try {
      await mkdir(path.join(root, "posts"));
      await writeFile(path.join(root, "posts/valid.md"), "---\ntitle: Valid\n---\nBody\n");
      await writeFile(path.join(root, "posts/broken.md"), "---\ntitle: [unterminated\n---\n");
      await writeFile(path.join(root, "posts/broken.json"), "{");
      await writeFile(path.join(root, "authors.json"), "[");
      const registry = {
        posts: defineCollection({
          loader: glob({ pattern: ["*.md", "*.json"], base: "./posts" }),
          schema: z.object({ title: z.string() }),
        }),
        authors: defineCollection({
          loader: file("./authors.json"),
          schema: z.object({ name: z.string() }),
        }),
      };
      await expect(
        createSession({ root, config: "unused", outDir: "unused", registry, watch: false }),
      ).rejects.toMatchObject({
        code: "source-error",
        diagnostics: [
          expect.objectContaining({
            code: "source-error",
            operation: "build",
            collection: "posts",
            source: path.join(root, "posts/broken.json"),
            message: expect.stringContaining('Could not load "broken.json": '),
            cause: expect.any(Error),
          }),
          expect.objectContaining({
            collection: "posts",
            source: path.join(root, "posts/broken.md"),
            message: expect.stringMatching(/Could not load "broken\.md": .*indented/),
          }),
          expect.objectContaining({
            collection: "authors",
            source: path.join(root, "authors.json"),
            message: expect.stringContaining('Could not load "./authors.json": '),
          }),
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("retention controls public text while computed fields can still read captured input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-retain-"));
    try {
      await writeFile(path.join(root, "post.md"), "---\ntitle: Title\n---\n## Hello\n");
      for (const deferRender of [false, true]) {
        const registry = {
          posts: defineCollection({
            loader: glob({ pattern: "*.md", base: root, retainBody: false, deferRender }),
            schema: z.object({ title: z.string() }),
            computed: {
              raw: { schema: z.string(), resolve: async ({ readBody }) => (await readBody())! },
            },
          }),
        };
        const session = await createSession<typeof registry>({
          root,
          config: "unused",
          outDir: path.join(root, ".content-query"),
          registry,
          watch: false,
        });
        expect(await session.content.readBody("posts", "post")).toBeUndefined();
        expect((await session.content.query("posts").select("raw").first())?.raw).toContain(
          "## Hello",
        );
        expect((await session.content.render("posts", "post")).headings).toEqual([
          { depth: 2, slug: "hello", text: "Hello" },
        ]);
        await session.dispose();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("watches a nonexistent glob base and removes deleted entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-missing-base-"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = {
      posts: defineCollection({
        loader: glob({ pattern: "*.md", base: "./later" }),
        schema: z.object({ title: z.string() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: path.join(root, "unused.ts"),
      outDir: path.join(root, ".content-query"),
      registry,
      watch: true,
    });
    try {
      expect(await session.content.query("posts").count()).toBe(0);
      expect(warn).toHaveBeenCalled();
      await mkdir(path.join(root, "later"));
      await writeFile(path.join(root, "later/new.md"), "---\ntitle: New\n---\n");
      await vi.waitFor(async () => expect(await session.content.query("posts").count()).toBe(1));
      await rm(path.join(root, "later/new.md"));
      await vi.waitFor(async () => expect(await session.content.query("posts").count()).toBe(0));
      await sessionInternals(session).idle();
    } finally {
      await session.dispose();
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
