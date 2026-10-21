import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../../collection/define.ts";
import type { ComputedContext } from "../../collection/types.ts";
import type { Loader, LoaderContext } from "../../loaders/types.ts";
import { createSession, sessionInternals } from "../session.ts";

describe("loader-provided computed source metadata", () => {
  test("recomputes metadata-only updates while preserving Astro digest semantics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-source-metadata-"));
    type Source = { documentId: string; url: string };
    let context: LoaderContext<Source>;
    const loader: Loader<Source> = {
      name: "typed-cms",
      async load(active) {
        context = active;
        active.store.set({
          id: "one",
          data: { title: "Fixed" },
          source: { documentId: "doc-one", url: "/first" },
          digest: "first",
        });
      },
    };
    const resolve = vi.fn(({ source }: ComputedContext<{ title: string }, Source>) => source?.url);
    const registry = {
      posts: defineCollection({
        loader,
        schema: z.object({ title: z.string() }),
        computed: { url: { schema: z.string().optional(), resolve } },
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
      expect(await session.content.select("url").from("posts").first()).toEqual({ url: "/first" });
      expect(
        context!.store.set({
          id: "one",
          data: { title: "Fixed" },
          source: { documentId: "doc-one", url: "/ignored" },
          digest: "first",
        }),
      ).toBe(false);
      expect(resolve).toHaveBeenCalledTimes(1);
      context!.store.set({
        id: "one",
        data: { title: "Fixed" },
        source: { documentId: "doc-one", url: "/second" },
        digest: "second",
      });
      await sessionInternals(session).idle();
      expect(await session.content.select("url").from("posts").first()).toEqual({
        url: "/second",
      });
      expect(resolve).toHaveBeenCalledTimes(2);
      context!.store.set({
        id: "one",
        data: { title: "Fixed" },
        source: { documentId: "doc-one", url: "/second" },
        digest: "third",
      });
      await sessionInternals(session).idle();
      expect(resolve).toHaveBeenCalledTimes(2);
      context!.store.set({ id: "one", data: { title: "Fixed" } });
      await sessionInternals(session).idle();
      expect(await session.content.select("title", "url").from("posts").first()).toEqual({
        title: "Fixed",
        url: undefined,
      });
      expect(resolve).toHaveBeenCalledTimes(3);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("isolates source metadata between loaders, stored entries, and computed fields", async () => {
    const authored = { nested: { value: "Original" } };
    let context: LoaderContext<typeof authored>;
    const loader: Loader<typeof authored> = {
      name: "mutable-metadata",
      async load(active) {
        context = active;
        active.store.set({ id: "one", data: {}, source: authored });
      },
    };
    const registry = {
      posts: defineCollection({
        loader,
        computed: {
          changed: {
            schema: z.string(),
            resolve: ({ source }) => {
              source!.nested.value = "Changed";
              return source!.nested.value;
            },
          },
          original: { schema: z.string(), resolve: ({ source }) => source!.nested.value },
        },
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
      expect(await session.content.select("changed", "original").from("posts").first()).toEqual({
        changed: "Changed",
        original: "Original",
      });
      expect(authored.nested.value).toBe("Original");
      expect(context!.store.get("one")!.source).toEqual({ nested: { value: "Original" } });
    } finally {
      await session.dispose();
    }
  });

  test("rejects executable source metadata at the loader boundary", async () => {
    const registry = {
      posts: defineCollection({
        loader: {
          name: "invalid-metadata",
          async load({ store }) {
            store.set({ id: "one", data: {}, source: { callback: () => "unsupported" } });
          },
        },
      }),
    };
    await expect(
      createSession({
        root: os.tmpdir(),
        config: "unused",
        outDir: ".content-query",
        registry,
        watch: false,
      }),
    ).rejects.toMatchObject({ code: "source-error", collection: "posts" });
  });
});
