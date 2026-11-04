import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { glob } from "../loaders.ts";
import { schema } from "../schema.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { createSession, sessionInternals } from "./session.ts";
import { prepareRevision, type CandidateSources, type PreparationCache } from "./prepare.ts";
import { createArtifactRuntime } from "../internal.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import { eq } from "../query.ts";
import { ContentError } from "../shared/errors.ts";
import type { Content } from "../runtime.ts";
import type { PreparedRevision } from "../runtime/revision.ts";

const root = fileURLToPath(new URL("../../tests/fixtures/exercises", import.meta.url));
const base = path.join(root, "coding");

/** Reads a file next to an exercise's manifest. */
function exerciseFile(filePath: string, ...segments: string[]): Promise<string> {
  return readFile(path.join(root, path.dirname(filePath), ...segments), "utf8");
}

/** Declares exercises from `*\/exercise.json` with localized hints and a single walkthrough. */
function exercises() {
  return {
    coding: defineCollection({
      loader: glob({
        base,
        pattern: "*/exercise.json",
        generateId: ({ entry }) => entry.split("/")[0]!,
      }),
      schema: schema.object({
        title: schema.string(),
        difficulty: schema.enum(["easy", "medium", "hard"]),
        locales: schema.array(schema.string()),
      }),
      payloads: {
        detail: {
          schema: schema.object({ locale: schema.string(), hints: schema.string() }),
          variants: { locale: "locales" },
          resolve: async ({ source, variant }) => ({
            locale: variant.locale,
            hints: (await exerciseFile(source!.filePath, "hints", `${variant.locale}.md`)).trim(),
          }),
        },
        walkthrough: {
          schema: schema.object({ markdown: schema.string() }),
          resolve: async ({ source }) => ({
            markdown: (await exerciseFile(source!.filePath, "walkthrough.md")).trim(),
          }),
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
  let content: Content<typeof registry> = session.content;
  if (encoded) {
    content = createArtifactRuntime<typeof registry>(
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
        expect(await content.from("coding").select("id", "title").orderBy("title")).toEqual([
          { id: "reverse-list", title: "Reverse a List" },
          { id: "two-sum", title: "Two Sum" },
        ]);
        const detail = await content.query.coding.findFirst({
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
        const relational = await content.query.coding.findMany({
          columns: { id: true },
          where: { difficulty: "easy" },
          payloads: { detail: { locale: "en-US" }, walkthrough: true },
        });
        const fluent = await content
          .from("coding")
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
        const [first, second] = await content.query.coding.findMany({
          columns: { id: true },
          where: { id: "two-sum" },
          payloads: { walkthrough: true },
        });
        expect(second).toBeUndefined();
        first!._payloads.walkthrough.markdown = "changed";
        expect(
          (
            await content.query.coding.findFirst({
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
        const missing = await content.query.coding
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
        const findFirst = (options: unknown) => content.query.coding.findFirst(options as never);
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

/** Prepares a one-collection registry from fixture entries, without a session. */
async function prepareEntries(
  definition: ReturnType<typeof defineCollection>,
  entries: { id: string; data: Record<string, unknown> }[],
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
async function checkTypes(content: Content<ReturnType<typeof exercises>>) {
  const detail = await content.query.coding.findFirst({
    where: { id: "two-sum" },
    payloads: { detail: { locale: "en-US" }, walkthrough: true },
  });
  const hints: string | undefined = detail?._payloads.detail.hints;
  const markdown: string | undefined = detail?._payloads.walkthrough.markdown;
  const fluent = await content
    .from("coding")
    .select("title")
    .withPayload("detail", { locale: "en-US" })
    .first();
  const fluentHints: string | undefined = fluent?._payloads.detail.hints;
  void [hints, markdown, fluentHints];
  // @ts-expect-error Variant payloads require their variant keys.
  void content.query.coding.findFirst({ payloads: { detail: true } });
  // @ts-expect-error Variant keys are checked against the declaration.
  void content.query.coding.findFirst({ payloads: { detail: { locale: "en-US", level: "easy" } } });
  // @ts-expect-error Payloads without variants take true.
  void content.query.coding.findFirst({ payloads: { walkthrough: { locale: "en-US" } } });
  // @ts-expect-error Fluent variant payloads require their variant keys.
  void content.from("coding").select("id").withPayload("detail");
  // @ts-expect-error Fluent payloads without variants take no variant.
  void content.from("coding").select("id").withPayload("walkthrough", { locale: "en-US" });
  // @ts-expect-error Unknown payload names are rejected.
  void content.query.coding.findFirst({ payloads: { missing: true } });
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
