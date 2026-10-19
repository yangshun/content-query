import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { csvLoader } from "@ascorbic/csv-loader";
import type { Loader as AstroLoader } from "astro/loaders";
import type { LoaderContext as AstroContext } from "astro/loaders";
import type { LoaderContext } from "../../loaders/types.ts";
import { z } from "zod";
import { z as legacyZod } from "zod/v3";
import * as coreZod from "zod/v4/core";
import type { Loader } from "../../loaders/types.ts";
import { collectLoader } from "../../../tests/helpers/loader.ts";
import { defineCollection } from "../../collection/define.ts";
import { createSession } from "../../preparation/session.ts";

/** Checks that the native loader context remains a structural subset of Astro's public context. */
function acceptsAstroContext(context: AstroContext): LoaderContext {
  return context;
}
void acceptsAstroContext;

describe("Astro content loader compatibility", () => {
  test("recovers a failed initial load before the loader has installed its source listeners", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-loader-startup-"));
    const filename = path.join(root, "source.txt");
    await writeFile(filename, "invalid");
    const load = vi.fn(async (context: LoaderContext) => {
      /** Refreshes the native store from a local source. */
      async function refresh(): Promise<void> {
        const title = await readFile(filename, "utf8");
        if (title === "invalid") {
          throw new Error("Invalid source");
        }
        context.store.set({
          id: "one",
          data: await context.parseData({ id: "one", data: { title } }),
        });
      }
      await refresh();
      context.watcher?.on("change", refresh);
    });
    const registry = {
      posts: defineCollection({
        loader: { name: "startup", load },
        schema: z.object({ title: z.string() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    const title = () => session.content.query("posts").select("title").first();
    try {
      await expect(title()).rejects.toMatchObject({ code: "source-error" });
      await writeFile(filename, "Recovered");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Recovered" }));
      await writeFile(filename, "Updated again");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Updated again" }));
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  for (const [name, schema] of [
    ["legacy Zod", legacyZod.object({ title: legacyZod.string() })],
    [
      "core Zod",
      new coreZod.$ZodObject({
        type: "object",
        shape: { title: new coreZod.$ZodString({ type: "string" }) },
      }),
    ],
  ] as const) {
    test(`validates loader-provided ${name} schemas`, async () => {
      const loader: Loader = {
        name,
        schema,
        async load(context) {
          context.store.set({
            id: "one",
            data: await context.parseData({ id: "one", data: { title: "Hello" } }),
          });
        },
      };
      expect(await collectLoader(loader)).toEqual([{ id: "one", data: { title: "Hello" } }]);
    });
  }

  test("resolves dynamic schemas once and lets collection schemas override them", async () => {
    const createSchema = vi.fn(async () => ({
      schema: z.object({ title: z.string().transform((title) => title + "!") }),
      types: "unused",
    }));
    const loader: Loader = {
      name: "dynamic",
      createSchema,
      async load(context) {
        for (const id of ["one", "two"]) {
          context.store.set({ id, data: await context.parseData({ id, data: { title: id } }) });
        }
      },
    };
    expect((await collectLoader(loader)).map((entry) => entry.data.title)).toEqual([
      "one!",
      "two!",
    ]);
    expect(createSchema).toHaveBeenCalledTimes(1);
    const registry = {
      posts: defineCollection({
        loader,
        schema: z.object({ title: z.string().transform((title) => title.toUpperCase()) }),
      }),
    };
    const session = await createSession<typeof registry>({
      root: os.tmpdir(),
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: false,
    });
    try {
      expect(await session.content.query("posts").select("title").all()).toEqual([
        { title: "ONE" },
        { title: "TWO" },
      ]);
      expect(createSchema).toHaveBeenCalledTimes(1);
    } finally {
      await session.dispose();
    }
  });

  test("publishes asynchronous watcher callbacks atomically and recovers after invalid data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-loader-batch-"));
    const filename = path.join(root, "source.txt");
    await writeFile(filename, "initial");
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let next: unknown = "Changed";
    let wait = true;
    const loader: Loader = {
      name: "watched",
      async load(context) {
        context.store.set({
          id: "one",
          data: await context.parseData({ id: "one", data: { title: "Initial" } }),
        });
        context.watcher?.on("change", async () => {
          context.store.clear();
          entered();
          if (wait) {
            await gate;
          }
          context.store.set({
            id: "one",
            data: await context.parseData({ id: "one", data: { title: next } }),
          });
        });
      },
    };
    const registry = {
      posts: defineCollection({ loader, schema: z.object({ title: z.string() }) }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    const title = () => session.content.query("posts").select("title").first();
    try {
      await writeFile(filename, "changed");
      await started;
      expect(await title()).toEqual({ title: "Initial" });
      release();
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Changed" }));
      wait = false;
      next = 123;
      await writeFile(filename, "invalid");
      await vi.waitFor(() => expect(title()).rejects.toMatchObject({ code: "validation-error" }));
      next = "Recovered";
      await writeFile(filename, "corrected");
      await vi.waitFor(async () => expect(await title()).toEqual({ title: "Recovered" }));
    } finally {
      release();
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  test("uses the published CSV loader with collection transforms and development updates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-astro-csv-"));
    const filename = path.join(root, "authors.csv");
    await writeFile(filename, "id,name\nada,Ada\n");
    const transform = vi.fn((data: { name: string }) => ({ name: `${data.name}!` }));
    const registry = {
      authors: defineCollection({
        loader: csvLoader({ fileName: "./authors.csv", idField: "id" }),
        schema: z.object({ name: z.string() }).transform(transform),
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    try {
      expect(await session.content.query("authors").select("id", "name").all()).toEqual([
        { id: "ada", name: "Ada!" },
      ]);
      expect(transform).toHaveBeenCalledTimes(1);
      await writeFile(filename, "id,name\ngrace,Grace\n");
      await vi.waitFor(async () => {
        expect(await session.content.query("authors").select("id", "name").all()).toEqual([
          { id: "grace", name: "Grace!" },
        ]);
      });
      expect(transform).toHaveBeenCalledTimes(2);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("inherits loader schemas and preserves Markdown, HTML, and headings", async () => {
    const loader: AstroLoader = {
      name: "markdown-example",
      schema: z.object({ title: z.string().transform((title) => title.toUpperCase()) }),
      async load(context) {
        const { collection, store, meta } = context;
        expect(collection).toBe("posts");
        meta.set("cursor", "one");
        expect(meta.get("cursor")).toBe("one");
        const body = "# Hello\n";
        const data = await context.parseData({ id: "hello", data: { title: "Hello" } });
        const digest = context.generateDigest(data);
        expect(digest).toBe(context.generateDigest(data));
        expect(
          store.set({
            id: "hello",
            data,
            body,
            digest,
            rendered: await context.renderMarkdown(body),
          }),
        ).toBe(true);
        expect(store.set({ id: "hello", data, digest })).toBe(false);
        expect(store.keys()).toEqual(["hello"]);
      },
    };
    const registry = { posts: defineCollection({ loader: loader }) };
    const session = await createSession<typeof registry>({
      root: os.tmpdir(),
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: false,
    });
    try {
      expect(await session.content.query("posts").select("id", "title").all()).toEqual([
        { id: "hello", title: "HELLO" },
      ]);
      expect(await session.content.readBody("posts", "hello")).toBe("# Hello\n");
      expect(await session.content.render("posts", "hello")).toEqual({
        html: '<h1 id="hello">Hello</h1>\n',
        headings: [{ depth: 1, slug: "hello", text: "Hello" }],
      });
    } finally {
      await session.dispose();
    }
  });
});
