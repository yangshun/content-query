import { cp, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import type { CollectionRegistry, ComputedContext } from "../collection/types.ts";
import { glob } from "../loaders.ts";
import { schema } from "../schema.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { computedFields } from "../computed.ts";
import { lt } from "../query.ts";

const fixtures = fileURLToPath(new URL("../../tests/fixtures/exercises", import.meta.url));

/**
 * Declares exercises whose walkthrough fields come from one read of `walkthrough.md`, recording
 * each call to the shared resolver.
 */
function exercises(base: string, calls: string[]) {
  return {
    coding: defineCollection({
      loader: glob({
        base,
        pattern: "*/exercise.json",
        generateId: ({ entry }) => entry.split("/")[0]!,
      }),
      schema: schema.object({ title: schema.string() }),
      computed: {
        ...computedFields({
          fields: {
            walkthroughWords: schema.number(),
            walkthroughOpening: schema.string(),
            walkthroughNote: schema.string().optional(),
          },
          resolve: async ({ id, files }) => {
            calls.push(id);
            const text = (await files.text("walkthrough.md")).trim();
            return { walkthroughWords: text.split(/\s+/).length, walkthroughOpening: text };
          },
        }),
        upperTitle: { schema: schema.string(), resolve: ({ data }) => data.title.toUpperCase() },
      },
    }),
  };
}

/** Prepares a session over the given registry, rooted at the fixture directory. */
function session<Registry extends CollectionRegistry>(
  registry: Registry,
  root = fixtures,
  watch = false,
) {
  return createSession<Registry>({ root, config: "unused", outDir: "unused", watch, registry });
}

/** Waits past the watcher's write-settling delay. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe("computedFields", () => {
  test("fills several fields from one resolver call per entry", async () => {
    const calls: string[] = [];
    const content = await session(exercises(path.join(fixtures, "coding"), calls));
    try {
      expect(calls.sort()).toEqual(["reverse-list", "two-sum"]);
      expect(
        await content.collections.coding
          .byId("two-sum")
          .select("walkthroughWords", "walkthroughOpening", "walkthroughNote", "upperTitle"),
      ).toStrictEqual({
        walkthroughWords: 10,
        walkthroughOpening: "For each number, look up its complement before storing it.",
        walkthroughNote: undefined,
        upperTitle: "TWO SUM",
      });
      // Each field filters and sorts like any other computed field.
      expect(
        await content.collections.coding.select("id").orderBy("walkthroughWords", "desc"),
      ).toStrictEqual([{ id: "reverse-list" }, { id: "two-sum" }]);
      expect(
        await content.collections.coding
          .select("id")
          .where((fields) => lt(fields.walkthroughWords, 11)),
      ).toStrictEqual([{ id: "two-sum" }]);
    } finally {
      await content.dispose();
    }
  });

  test("resolves again when a file it read changes", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-fields-")));
    const base = path.join(root, "content/coding");
    await cp(path.join(fixtures, "coding"), base, { recursive: true });
    const calls: string[] = [];
    const content = await session(exercises(base, calls), root, true);
    try {
      await settle();
      await sessionInternals(content).idle();
      calls.length = 0;
      await writeFile(path.join(base, "two-sum/walkthrough.md"), "Look up each complement.\n");
      await vi.waitFor(
        async () =>
          expect(
            await content.collections.coding
              .byId("two-sum")
              .select("walkthroughWords", "walkthroughOpening"),
          ).toStrictEqual({
            walkthroughWords: 4,
            walkthroughOpening: "Look up each complement.",
          }),
        { timeout: 5_000 },
      );
      expect(calls).toEqual(["two-sum"]);
    } finally {
      await content.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  test("validates each field with its own schema", async () => {
    const registry = {
      items: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        computed: computedFields({
          fields: { count: schema.number(), label: schema.string() },
          resolve: () => ({ count: "three", label: "Three" }) as never,
        }),
      }),
    };
    await expect(session(registry)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({ id: "one", path: ["count"] })],
    });
  });

  test("reports a failing resolver against every field it fills", async () => {
    const failure = new Error("info/en-US.json is malformed");
    const registry = {
      items: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        computed: computedFields({
          fields: { title: schema.string(), summary: schema.string() },
          resolve: () => Promise.reject(failure),
        }),
      }),
    };
    const error = await session(registry).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({
      diagnostics: [
        expect.objectContaining({ path: ["title"], message: 'Computed field "title" failed.' }),
        expect.objectContaining({ path: ["summary"], message: 'Computed field "summary" failed.' }),
      ],
    });
  });

  test("rejects results that are not objects", async () => {
    const registry = {
      items: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        computed: computedFields({
          fields: { title: schema.string() },
          resolve: () => "Title" as never,
        }),
      }),
    };
    const error = await session(registry).then(
      () => undefined,
      (cause: unknown) => cause as { diagnostics: { cause?: unknown }[] },
    );
    expect(String(error?.diagnostics[0]?.cause)).toContain(
      "computedFields() resolve must return an object",
    );
  });

  test("types data from an annotated resolver context", () => {
    type Article = { description: string };
    const fields = computedFields({
      fields: { summary: schema.string() },
      resolve: ({ data }: ComputedContext<Article>) => ({ summary: data.description }),
    });
    expect(Object.keys(fields)).toEqual(["summary"]);
    computedFields({
      fields: { summary: schema.string(), note: schema.string().optional() },
      // @ts-expect-error The result needs every field whose schema rejects undefined.
      resolve: () => ({ note: "Missing summary" }),
    });
  });

  test("rejects declarations without schemas or a resolver", () => {
    expect(() => computedFields({ fields: {}, resolve: () => ({}) })).toThrow(
      "computedFields() fields must declare at least one field, each with a Standard Schema.",
    );
    expect(() =>
      computedFields({ fields: { title: "string" as never }, resolve: () => ({}) as never }),
    ).toThrow(TypeError);
    expect(() => computedFields({ fields: { title: schema.string() } } as never)).toThrow(
      "computedFields() resolve must be a function.",
    );
    expect(() => computedFields(undefined as never)).toThrow(TypeError);
  });
});
