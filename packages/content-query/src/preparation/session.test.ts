import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import {
  type Loader,
  type LoaderContext,
  type LoaderEntry,
  type LoaderWatchContext,
} from "../loaders/types.ts";
import { createSession, sessionInternals } from "./session.ts";
import { executeQuery } from "../runtime/execute.ts";

/** Controls native store writes deterministically while testing revision publication. */
function source(initial: LoaderEntry[]) {
  let active: LoaderContext;
  let entries = initial;
  const loader: Loader = {
    name: "controlled-source",
    async load(context) {
      active = context;
      context.store.clear();
      for (const entry of entries) {
        context.store.set({ ...entry, filePath: entry.source });
      }
    },
  };
  /** Replaces the complete source store, including after a failed validation. */
  function replace(next: LoaderEntry[]): void {
    entries = next;
    active.store.clear();
    for (const entry of entries) {
      active.store.set({ ...entry, filePath: entry.source });
    }
  }
  const context: LoaderWatchContext = {
    get signal() {
      return active.signal!;
    },
    invalidate: () => replace(entries),
    error: (cause) => {
      (active.watcher as unknown as { emit(event: string, cause: unknown): void }).emit(
        "error",
        cause,
      );
    },
    update(batch) {
      const next = new Map(entries.map((entry) => [entry.id, entry]));
      for (const id of batch.remove ?? []) {
        next.delete(id);
      }
      for (const entry of batch.upsert ?? []) {
        next.set(entry.id, entry);
      }
      replace([...next.values()]);
    },
  };
  return { loader, context, replace };
}

describe("watch lifecycle and revision publication", () => {
  test("pins asynchronous query and rendering work while a newer revision is published", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-inflight-"));
    const records = source([{ id: "one", data: { title: "A" } }]);
    const registry = {
      posts: defineCollection({ loader: records.loader, schema: z.object({ title: z.string() }) }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: ".content-query",
      registry,
      watch: true,
    });
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    try {
      const revision = sessionInternals(session).state.revision!;
      revision.execute = async (plan, terminal) => {
        await gate;
        return executeQuery(revision, plan, terminal);
      };
      revision.collections.posts!.payloads = new Map([["one", async () => ({ markdown: "A" })]]);
      revision.renderMarkdown = async (body) => {
        await gate;
        return { html: body, headings: [] };
      };
      const oldQuery = session.content.select("title").from("posts").first();
      const oldRender = session.content.render("posts", "one");
      records.context.update({
        upsert: [{ id: "one", data: { title: "B" }, rendered: { html: "B" } }],
      });
      await sessionInternals(session).idle();
      expect(await session.content.select("title").from("posts").first()).toEqual({ title: "B" });
      expect((await session.content.render("posts", "one")).html).toBe("B");
      finish!();
      expect(await oldQuery).toEqual({ title: "A" });
      expect((await oldRender).html).toBe("A");
      expect((await session.content.render("posts", "one")).html).toBe("B");
    } finally {
      finish!();
      await session.dispose();
      await rm(root, { force: true, recursive: true });
    }
  });
  test("aggregates source and independent validation failures without speculative references", async () => {
    const registry = {
      unavailable: defineCollection({
        loader: fixtureLoader(() => {
          throw new Error("offline");
        }),
        schema: z.object({ name: z.string() }),
      }),
      invalid: defineCollection({
        loader: fixtureLoader(() => [{ id: "broken", data: { name: 1 } }]),
        schema: z.object({ name: z.string() }),
      }),
    };
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", registry, watch: false }),
    ).rejects.toMatchObject({
      code: "source-error",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          collection: "unavailable",
          code: "source-error",
          cause: expect.any(Error),
        }),
        expect.objectContaining({
          collection: "invalid",
          code: "validation-error",
          issues: expect.any(Array),
        }),
      ]),
    });
  });
  test("returns an initially failed session and recovers in place", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-watch-"));
    const records = source([{ id: "one", data: { title: 1 } }]);
    const registry = {
      posts: defineCollection({ loader: records.loader, schema: z.object({ title: z.string() }) }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: path.join(root, "unused.ts"),
      outDir: path.join(root, ".content-query"),
      registry,
      watch: true,
    });
    try {
      await expect(session.content.select("title").from("posts").all()).rejects.toMatchObject({
        code: "validation-error",
      });
      records.context.update({ upsert: [{ id: "one", data: { title: "Corrected" } }] });
      await sessionInternals(session).idle();
      expect(await session.content.select("title").from("posts").all()).toEqual([
        { title: "Corrected" },
      ]);
      records.context.error(new Error("subscription lost"));
      await sessionInternals(session).idle();
      await expect(session.content.readBody("posts", "one")).rejects.toMatchObject({
        code: "source-error",
      });
      records.replace([{ id: "one", data: { title: "Recovered again" } }]);
      await sessionInternals(session).idle();
      expect(await session.content.select("title").from("posts").first()).toEqual({
        title: "Recovered again",
      });
    } finally {
      await session.dispose();
      await session.dispose();
      await rm(root, { force: true, recursive: true });
    }
    expect(records.context.signal.aborted).toBe(true);
  });
  test("retains failed cross-collection candidates until the referencing collection is corrected", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-candidates-"));
    const posts = source([
      { id: "one", data: { title: "One" } },
      { id: "two", data: { title: "Two" } },
    ]);
    const authors = source([{ id: "ada", data: { featured: ["one"] } }]);
    const registry = {
      posts: defineCollection({ loader: posts.loader, schema: z.object({ title: z.string() }) }),
      authors: defineCollection({
        loader: authors.loader,
        schema: z.object({ featured: z.array(z.string()) }),
        relationships: {
          featuredPosts: {
            collection: "posts",
            type: "many",
            from: "featured",
            to: "id",
            referenceSide: "from",
          },
        },
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: path.join(root, ".content-query"),
      registry,
      watch: true,
    });
    try {
      posts.context.update({ remove: ["one"], upsert: [{ id: "two", data: { title: "Edited" } }] });
      await sessionInternals(session).idle();
      await expect(session.content.select().from("posts").count()).rejects.toMatchObject({
        code: "invalid-reference",
      });
      authors.context.update({ upsert: [{ id: "ada", data: { featured: [] } }] });
      await sessionInternals(session).idle();
      expect(await session.content.select("id", "title").from("posts").all()).toEqual([
        { id: "two", title: "Edited" },
      ]);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  test("finishes an active payload read on A after publishing B or failing a later attempt", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-pinned-"));
    const records = source([{ id: "one", data: { title: "A" }, body: "A body" }]);
    const registry = {
      posts: defineCollection({ loader: records.loader, schema: z.object({ title: z.string() }) }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: path.join(root, ".content-query"),
      registry,
      watch: true,
    });
    try {
      let finish: ((value: { body: string }) => void) | undefined;
      const payload = new Promise<{ body: string }>((resolve) => {
        finish = resolve;
      });
      const revision = sessionInternals(session).state.revision!;
      revision.collections.posts!.payloads = new Map([["one", () => payload]]);
      const active = session.content.readBody("posts", "one");
      await Promise.resolve();
      expect(revision.active).toBe(1);
      records.context.update({ upsert: [{ id: "one", data: { title: "B" }, body: "B body" }] });
      await sessionInternals(session).idle();
      expect(await session.content.readBody("posts", "one")).toBe("B body");
      records.context.update({ upsert: [{ id: "one", data: { title: false } }] });
      await sessionInternals(session).idle();
      await expect(session.content.select().from("posts").count()).rejects.toMatchObject({
        code: "validation-error",
      });
      finish!({ body: "A body" });
      expect(await active).toBe("A body");
      expect(revision.active).toBe(0);
    } finally {
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
  test("supersedes an uncooperative computed resolver without waiting for it", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "content-query-abort-"));
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const processing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const records = source([{ id: "one", data: { title: "A" } }]);
    const registry = {
      posts: defineCollection({
        loader: records.loader,
        schema: z.object({ title: z.string() }),
        computed: {
          processed: {
            schema: z.string(),
            resolve: async ({ data }) => {
              if (data.title === "slow") {
                started!();
                await gate;
              }
              return data.title;
            },
          },
        },
      }),
    };
    const session = await createSession<typeof registry>({
      root,
      config: "unused",
      outDir: path.join(root, ".content-query"),
      registry,
      watch: true,
    });
    try {
      records.context.update({ upsert: [{ id: "one", data: { title: "slow" } }] });
      await processing;
      records.context.update({ upsert: [{ id: "one", data: { title: "latest" } }] });
      await sessionInternals(session).idle();
      expect(await session.content.select("processed").from("posts").first()).toEqual({
        processed: "latest",
      });
      finish!();
      await Promise.resolve();
      expect(await session.content.select("title").from("posts").first()).toEqual({
        title: "latest",
      });
    } finally {
      finish!();
      await session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
