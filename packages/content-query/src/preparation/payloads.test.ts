import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { glob } from "../loaders.ts";
import { schema } from "../schema.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { createSession, sessionInternals } from "./session.ts";
import { prepareRevision, type CandidateSources, type PreparationCache } from "./prepare.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import { eq } from "../query.ts";
import { ContentError } from "../shared/errors.ts";
import type { PreparedRevision } from "../runtime/revision.ts";
import { loadAll, loadArtifact } from "../../tests/helpers/collections.ts";
import type { AllCollections } from "../../tests/helpers/collections.ts";

const root = fileURLToPath(new URL("../../tests/fixtures/exercises", import.meta.url));
const base = path.join(root, "coding");

/** Declares exercises from `*\/exercise.json` with localized hints and a single walkthrough. */
function exercises(exerciseBase = base, resolved: string[] = []) {
  return {
    coding: defineCollection({
      loader: glob({
        base: exerciseBase,
        pattern: "*/exercise.json",
        generateId: ({ entry }) => entry.split("/")[0]!,
      }),
      schema: schema.object({
        title: schema.string(),
        difficulty: schema.enum(["easy", "medium", "hard"]),
        locales: schema.array(schema.string()),
      }),
      computed: {
        walkthroughWords: {
          schema: schema.number(),
          resolve: async ({ files }) =>
            (await files.text("walkthrough.md")).trim().split(/\s+/).length,
        },
      },
      payloads: {
        detail: {
          schema: schema.object({ locale: schema.string(), hints: schema.string() }),
          variants: { locale: "locales" },
          resolve: async ({ id, files, variant }) => {
            resolved.push(`${id}:detail:${variant.locale}`);
            return {
              locale: variant.locale,
              hints: (await files.text(`hints/${variant.locale}.md`)).trim(),
            };
          },
        },
        walkthrough: {
          schema: schema.object({ markdown: schema.string() }),
          resolve: async ({ files }) => ({
            markdown: (await files.text("walkthrough.md")).trim(),
          }),
        },
        solutions: {
          schema: schema.array(schema.string()),
          resolve: async ({ id, files }) => {
            resolved.push(`${id}:solutions`);
            return (await files.glob({ pattern: "solution/*.md" })).map((entry) => entry.filePath);
          },
        },
      },
    }),
  };
}

/** Rebuilds a revision's custom payload table as generated loaders, spying on each import. */
function encodedPayloads(revision: PreparedRevision, collection: string) {
  const imports = vi.fn<(key: string) => void>();
  const table: NonNullable<EncodedCollection["payloads"]> = {};
  for (const [name, entries] of revision.collections[collection]!.payloads ?? []) {
    table[name] = {};
    for (const [id, variants] of entries) {
      table[name][id] = {};
      for (const [variant, load] of variants) {
        table[name][id][variant] = async () => {
          imports(`${name}:${id}:${variant}`);
          return { default: encode(await load()) };
        };
      }
    }
  }
  return { table, imports };
}

/** Prepares the exercises in memory, or through encoded artifacts with spied payload imports. */
async function setup(encoded: boolean) {
  const registry = exercises();
  const session = await createSession<typeof registry>({
    root,
    config: "unused",
    outDir: "unused",
    watch: false,
    registry,
  });
  const revision = sessionInternals(session).state.revision!;
  const { table, imports } = encodedPayloads(revision, "coding");
  let content: AllCollections<typeof registry> = loadAll(session.collections);
  if (encoded) {
    content = loadArtifact<typeof registry>(
      { version: ARTIFACT_VERSION, codec: CODEC_VERSION, collections: revision.registry },
      {
        coding: {
          records: revision.collections.coding!.records.map(encode),
          builtins: {},
          payloads: table,
        },
      },
    );
  }
  return { content, session, imports };
}

for (const encoded of [false, true]) {
  describe(`custom payloads, encoded=${encoded}`, () => {
    test("loads only the requested payload variant, never for catalog queries", async () => {
      const { content, session, imports } = await setup(encoded);
      try {
        expect(await content.coding.select("id", "title").orderBy("title")).toEqual([
          { id: "reverse-list", title: "Reverse a List" },
          { id: "two-sum", title: "Two Sum" },
        ]);
        const detail = await content.coding.findFirst({
          where: { id: "two-sum" },
          payloads: { detail: { locale: "fr-FR" } },
        });
        expect(detail).toEqual({
          _payloads: {
            detail: {
              locale: "fr-FR",
              hints: "Enregistrez l'indice de chaque nombre dans une table pendant le parcours.",
            },
          },
        });
        if (encoded) {
          expect(imports.mock.calls).toEqual([['detail:two-sum:{"locale":"fr-FR"}']]);
        }
      } finally {
        await session.dispose();
      }
    });

    test("matches relational and fluent requests, with and without variants", async () => {
      const { content, session } = await setup(encoded);
      try {
        const relational = await content.coding.findMany({
          columns: { id: true },
          where: { difficulty: "easy" },
          payloads: { detail: { locale: "en-US" }, walkthrough: true },
        });
        const fluent = await content.coding
          .select("id")
          .where((fields) => eq(fields.difficulty, "easy"))
          .withPayload("detail", { locale: "en-US" })
          .withPayload("walkthrough")
          .all();
        expect(relational).toEqual([
          {
            id: "two-sum",
            _payloads: {
              detail: { locale: "en-US", hints: "Store each number's index in a map as you scan." },
              walkthrough: {
                markdown: "For each number, look up its complement before storing it.",
              },
            },
          },
        ]);
        expect(fluent).toEqual(relational);
        const [first, second] = await content.coding.findMany({
          columns: { id: true },
          where: { id: "two-sum" },
          payloads: { walkthrough: true },
        });
        expect(second).toBeUndefined();
        first!._payloads.walkthrough.markdown = "changed";
        expect(
          (
            await content.coding.findFirst({
              where: { id: "two-sum" },
              payloads: { walkthrough: true },
            })
          )?._payloads.walkthrough.markdown,
        ).toBe("For each number, look up its complement before storing it.");
      } finally {
        await session.dispose();
      }
    });

    test("rejects variants an entry lacks and requests that misname variant keys", async () => {
      const { content, session } = await setup(encoded);
      try {
        const missing = await content.coding
          .findFirst({ where: { id: "reverse-list" }, payloads: { detail: { locale: "fr-FR" } } })
          .catch((error: unknown) => error);
        expect(missing).toBeInstanceOf(ContentError);
        expect(missing).toMatchObject({
          code: "variant-not-found",
          collection: "coding",
          id: "reverse-list",
          payload: "detail",
          variant: { locale: "fr-FR" },
          message: expect.stringContaining("detail[locale=fr-FR]"),
        });
        const findFirst = (options: unknown) => content.coding.findFirst(options as never);
        for (const detail of [true, {}, { locale: "en-US", level: "easy" }, { locale: 1 }]) {
          expect(() => findFirst({ where: { id: "two-sum" }, payloads: { detail } })).toThrow(
            /variant keys/,
          );
        }
        expect(() => findFirst({ where: { id: "two-sum" }, payloads: { missing: true } })).toThrow(
          /Unknown payload/,
        );
      } finally {
        await session.dispose();
      }
    });
  });
}

/** Gives the watcher time to report an event, if it were going to. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 400));
}

describe("tracked payload files in watch mode", () => {
  test("re-resolves only the nodes whose files change, including through glob membership", async () => {
    const projectRoot = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "content-query-tracked-")),
    );
    const coding = path.join(projectRoot, "content/coding");
    await cp(base, coding, { recursive: true });
    const resolved: string[] = [];
    const registry = exercises(coding, resolved);
    const session = await createSession<typeof registry>({
      root: projectRoot,
      config: "unused",
      outDir: ".content-query",
      watch: true,
      registry,
    });
    const content = loadAll(session.collections);
    /** Reads one exercise's metadata and payloads from the current revision. */
    const exercise = (id: string, locale: string) =>
      content.coding.findFirst({
        where: { id },
        columns: { walkthroughWords: true },
        payloads: { detail: { locale }, solutions: true },
      });
    try {
      // Every variant resolved once, at startup.
      expect(resolved.sort()).toEqual([
        "reverse-list:detail:en-US",
        "reverse-list:solutions",
        "two-sum:detail:en-US",
        "two-sum:detail:fr-FR",
        "two-sum:solutions",
      ]);
      await settle();
      await sessionInternals(session).idle();
      resolved.length = 0;

      await writeFile(path.join(coding, "two-sum/hints/fr-FR.md"), "Utilisez un dictionnaire.\n");
      await vi.waitFor(
        async () =>
          expect((await exercise("two-sum", "fr-FR"))?._payloads.detail.hints).toBe(
            "Utilisez un dictionnaire.",
          ),
        { timeout: 5_000 },
      );
      expect(resolved).toEqual(["two-sum:detail:fr-FR"]);
      await settle();
      await sessionInternals(session).idle();
      resolved.length = 0;

      await mkdir(path.join(coding, "reverse-list/solution"));
      await writeFile(path.join(coding, "reverse-list/solution/iterative.md"), "Walk once.\n");
      await vi.waitFor(
        async () =>
          expect((await exercise("reverse-list", "en-US"))?._payloads.solutions).toEqual([
            "content/coding/reverse-list/solution/iterative.md",
          ]),
        { timeout: 5_000 },
      );
      // The new directory and its file each re-read the glob; nothing else re-resolves.
      await settle();
      await sessionInternals(session).idle();
      expect(new Set(resolved)).toEqual(new Set(["reverse-list:solutions"]));
      resolved.length = 0;

      // A computed field's file re-prepares the entry and every payload variant it owns.
      await writeFile(path.join(coding, "two-sum/walkthrough.md"), "Look up each complement.\n");
      await vi.waitFor(
        async () => expect((await exercise("two-sum", "en-US"))?.walkthroughWords).toBe(4),
        { timeout: 5_000 },
      );
      expect(resolved.sort()).toEqual([
        "two-sum:detail:en-US",
        "two-sum:detail:fr-FR",
        "two-sum:solutions",
      ]);
      expect((await exercise("reverse-list", "en-US"))?.walkthroughWords).toBe(11);
    } finally {
      await session.dispose();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

/** Prepares a one-collection registry from fixture entries, without a session. */
async function prepareEntries(
  definition: ReturnType<typeof defineCollection>,
  entries: { id: string; data: Record<string, unknown>; sourceData?: unknown }[],
  cache: PreparationCache = new Map(),
) {
  const sources: CandidateSources = new Map([
    [
      "items",
      new Map(entries.map((entry) => [entry.id, { ...entry, source: `${entry.id}.json` }])),
    ],
  ]);
  return prepareRevision(
    { items: definition },
    sources,
    cache,
    new AbortController().signal,
    false,
  );
}

describe("preparePayloads", () => {
  test("re-resolves a payload with cache: false in every revision", async () => {
    const resolve = vi.fn(({ id }: { id: string }) => id);
    const definition = defineCollection({
      loader: fixtureLoader(() => []),
      payloads: { live: { schema: schema.string(), cache: false, resolve } },
    });
    const cache: PreparationCache = new Map();
    await prepareEntries(definition, [{ id: "a", data: {} }], cache);
    await prepareEntries(definition, [{ id: "a", data: {} }], cache);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  test("reports files failures with the payload, variant, file, and field", async () => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-query-cases-")));
    await writeFile(path.join(directory, "cases.json"), JSON.stringify([{ id: "one", input: 1 }]));
    try {
      const definition = defineCollection({
        loader: fixtureLoader(() => []),
        schema: schema.object({ locales: schema.array(schema.string()) }),
        payloads: {
          cases: {
            schema: schema.array(schema.unknown()),
            variants: { locale: "locales" },
            resolve: ({ files }) =>
              files.file("cases.json", { schema: schema.object({ input: schema.string() }) }),
          },
        },
      });
      const failure = await prepareEntries(definition, [
        { id: "with-folder", data: { locales: ["en"] }, sourceData: { directory } },
        { id: "without-folder", data: { locales: ["en"] } },
      ]).catch((error: unknown) => error);
      expect((failure as ContentError).diagnostics).toEqual([
        expect.objectContaining({
          collection: "items",
          id: "with-folder",
          payload: "cases",
          variant: { locale: "en" },
          source: `${path.join(directory, "cases.json")}#0`,
          path: ["input"],
        }),
        expect.objectContaining({
          id: "without-folder",
          payload: "cases",
          variant: { locale: "en" },
          message: expect.stringContaining("has no folder for files helpers"),
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses combinations() to override the cross product", async () => {
    const definition = defineCollection({
      loader: fixtureLoader(() => []),
      schema: schema.object({ locales: schema.array(schema.string()) }),
      payloads: {
        lesson: {
          schema: schema.string(),
          variants: { locale: "locales", level: ["easy", "hard"] },
          combinations: ({ variants }) =>
            variants.locale.map((locale) => ({ locale, level: locale === "en" ? "hard" : "easy" })),
          resolve: ({ variant }) => `${variant.locale}/${variant.level}`,
        },
      },
    });
    const revision = await prepareEntries(definition, [
      { id: "one", data: { locales: ["en", "fr"] } },
    ]);
    const variants = revision.collections.items!.payloads!.get("lesson")!.get("one")!;
    expect([...variants.keys()]).toEqual([
      '{"level":"hard","locale":"en"}',
      '{"level":"easy","locale":"fr"}',
    ]);
    expect(await variants.get('{"level":"hard","locale":"en"}')!()).toBe("en/hard");
  });

  test("reads variant values per entry, with no combinations when the field is absent", async () => {
    const definition = defineCollection({
      loader: fixtureLoader(() => []),
      schema: schema.object({ locales: schema.array(schema.string()).optional() }),
      payloads: {
        detail: {
          schema: schema.string(),
          variants: { locale: "locales" },
          resolve: ({ id, variant }) => `${id}:${variant.locale}`,
        },
      },
    });
    const revision = await prepareEntries(definition, [
      { id: "both", data: { locales: ["en", "fr", "en"] } },
      { id: "none", data: {} },
    ]);
    const detail = revision.collections.items!.payloads!.get("detail")!;
    expect([...detail.get("both")!.keys()]).toEqual(['{"locale":"en"}', '{"locale":"fr"}']);
    expect([...detail.get("none")!.keys()]).toEqual([]);
  });

  test("reuses resolved payloads for unchanged entries and re-resolves changed ones", async () => {
    const resolve = vi.fn(
      ({ id, data }: { id: string; data: { title: string } }) => `${id}:${data.title}`,
    );
    const definition = defineCollection({
      loader: fixtureLoader(() => []),
      schema: schema.object({ title: schema.string() }),
      payloads: { summary: { schema: schema.string(), resolve } },
    });
    const cache: PreparationCache = new Map();
    await prepareEntries(
      definition,
      [
        { id: "a", data: { title: "A" } },
        { id: "b", data: { title: "B" } },
      ],
      cache,
    );
    expect(resolve).toHaveBeenCalledTimes(2);
    const revision = await prepareEntries(
      definition,
      [
        { id: "a", data: { title: "A" } },
        { id: "b", data: { title: "B2" } },
      ],
      cache,
    );
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(resolve.mock.calls[2]![0].id).toBe("b");
    const summaries = revision.collections.items!.payloads!.get("summary")!;
    expect(await summaries.get("a")!.get("{}")!()).toBe("a:A");
    expect(await summaries.get("b")!.get("{}")!()).toBe("b:B2");
  });

  test("reports failing payloads with their payload, variant, and field path", async () => {
    const definition = defineCollection({
      loader: fixtureLoader(() => []),
      schema: schema.object({ locales: schema.array(schema.string()) }),
      payloads: {
        detail: {
          schema: schema.object({ hints: schema.array(schema.string()) }),
          variants: { locale: "locales" },
          resolve: ({ variant }) => {
            if (variant.locale === "fr") {
              throw new Error("Missing translation");
            }
            return { hints: [1] };
          },
        },
      },
    });
    const failure = await prepareEntries(definition, [
      { id: "one", data: { locales: ["en", "fr"] } },
    ]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ContentError);
    const diagnostics = (failure as ContentError).diagnostics;
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "validation-error",
        collection: "items",
        id: "one",
        source: "one.json",
        payload: "detail",
        variant: { locale: "en" },
        path: ["hints", 0],
      }),
      expect.objectContaining({
        code: "validation-error",
        payload: "detail",
        variant: { locale: "fr" },
        message: expect.stringContaining("detail[locale=fr] failed: Missing translation"),
      }),
    ]);
  });

  test.each([
    [{ _detail: { schema: schema.string(), resolve: (): string => "" } }, /leading "_"/],
    [
      { title: { schema: schema.string(), resolve: (): string => "" } },
      /computed field or relationship/,
    ],
    [{ detail: { resolve: (): string => "" } }, /requires a schema and a resolve/],
    [
      {
        detail: {
          schema: schema.string(),
          resolve: (): string => "",
          variants: { locale: () => ["en"] },
        },
      },
      /data field name or a list/,
    ],
    [
      {
        detail: { schema: schema.string(), resolve: (): string => "", variants: { locale: [""] } },
      },
      /data field name or a list/,
    ],
    [
      { detail: { schema: schema.string(), resolve: (): string => "", combinations: () => [] } },
      /requires declared variants/,
    ],
  ])("rejects invalid payload declarations %#", async (payloads, message) => {
    const failure = await prepareEntries(
      {
        loader: fixtureLoader(() => []),
        computed: { title: { schema: schema.string(), resolve: () => "" } },
        payloads,
      } as never,
      [{ id: "one", data: {} }],
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "validation-error",
      message: expect.stringMatching(message),
    });
  });

  test.each([
    [{ locale: "title" }, undefined, /non-empty strings in field "title"/],
    [{ locale: "codes" }, undefined, /non-empty strings in field "codes"/],
    [{ locale: ["en"] }, () => [{ locale: "fr" }], /one enumerated value/],
    [{ locale: ["en"] }, () => "en", /iterable of variants/],
  ])("rejects invalid variant values %#", async (variants, combinations, message) => {
    const failure = await prepareEntries(
      {
        loader: fixtureLoader(() => []),
        payloads: {
          detail: { schema: schema.string(), variants, combinations, resolve: () => "" },
        },
      } as never,
      [{ id: "one", data: { title: "One", codes: [1] } }],
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "validation-error",
      diagnostics: [
        expect.objectContaining({ payload: "detail", message: expect.stringMatching(message) }),
      ],
    });
  });
});

/** Checks payload declaration and query types without executing them. */
async function checkTypes(content: AllCollections<ReturnType<typeof exercises>>) {
  const detail = await content.coding.findFirst({
    where: { id: "two-sum" },
    payloads: { detail: { locale: "en-US" }, walkthrough: true },
  });
  const hints: string | undefined = detail?._payloads.detail.hints;
  const markdown: string | undefined = detail?._payloads.walkthrough.markdown;
  const fluent = await content.coding
    .select("title")
    .withPayload("detail", { locale: "en-US" })
    .first();
  const fluentHints: string | undefined = fluent?._payloads.detail.hints;
  void [hints, markdown, fluentHints];
  // @ts-expect-error Variant payloads require their variant keys.
  void content.coding.findFirst({ payloads: { detail: true } });
  // @ts-expect-error Variant keys are checked against the declaration.
  void content.coding.findFirst({ payloads: { detail: { locale: "en-US", level: "easy" } } });
  // @ts-expect-error Payloads without variants take true.
  void content.coding.findFirst({ payloads: { walkthrough: { locale: "en-US" } } });
  // @ts-expect-error Fluent variant payloads require their variant keys.
  void content.coding.select("id").withPayload("detail");
  // @ts-expect-error Fluent payloads without variants take no variant.
  void content.coding.select("id").withPayload("walkthrough", { locale: "en-US" });
  // @ts-expect-error Unknown payload names are rejected.
  void content.coding.findFirst({ payloads: { missing: true } });
}
void checkTypes;

/** Checks that payload resolvers and enumerators are contextually typed. */
function checkDeclarationTypes() {
  defineCollection({
    loader: fixtureLoader(() => []),
    schema: schema.object({ locales: schema.array(schema.string()) }),
    computed: { count: { schema: schema.number(), resolve: () => 1 } },
    payloads: {
      detail: {
        schema: schema.string(),
        variants: { locale: "locales", level: ["easy", "hard"] },
        combinations: ({ variants }) =>
          variants.locale.map((locale) => ({ locale, level: "easy" })),
        resolve: ({ variant, data }) => `${variant.locale}:${variant.level}:${data.count}`,
      },
      bad: {
        schema: schema.string(),
        variants: { locale: ["en"] },
        // @ts-expect-error Resolvers see only declared variant keys.
        resolve: ({ variant }) => variant.level,
      },
      field: {
        schema: schema.string(),
        // @ts-expect-error Variant fields must hold string arrays.
        variants: { locale: "count" },
        resolve: () => "",
      },
    },
  });
  defineCollection({
    loader: fixtureLoader(() => []),
    // @ts-expect-error Built-in payloads own the underscore prefix.
    payloads: { _detail: { schema: schema.string(), resolve: () => "" } },
  });
}
void checkDeclarationTypes;
