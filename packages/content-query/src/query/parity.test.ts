import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import * as operators from "../query.ts";
import { createArtifactRuntime } from "../internal.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";

/** Builds the same public consumer for live and production-encoded data. */
async function setup(encoded: boolean) {
  const registry = {
    authors: defineCollection({
      loader: fixtureLoader(() => [{ id: "ada", data: { name: "Ada" } }]),
      schema: z.object({ name: z.string() }),
    }),
    posts: defineCollection({
      loader: fixtureLoader(() => [
        {
          id: "a",
          data: {
            title: "Alpha",
            rank: 1,
            draft: false,
            authorId: "ada",
            tags: ["one", "two"],
            optional: undefined,
          },
        },
        {
          id: "b",
          data: {
            title: "Beta",
            rank: 2,
            draft: false,
            authorId: "ada",
            tags: ["two"],
            optional: null,
          },
        },
        { id: "c", data: { title: "Gamma", rank: 2, draft: false, authorId: "ada", tags: [] } },
        { id: "d", data: { title: "Draft", rank: 3, draft: true, authorId: "ada", tags: [] } },
      ]),
      schema: z.object({
        title: z.string(),
        rank: z.number(),
        draft: z.boolean(),
        authorId: z.string(),
        tags: z.array(z.string()),
        optional: z.string().nullish(),
      }),
      relationships: {
        author: {
          collection: "authors",
          type: "one",
          from: "authorId",
          to: "id",
          referenceSide: "from",
        },
      },
    }),
  };
  const session = await createSession<typeof registry>({
    root: ".",
    config: "unused",
    outDir: "unused",
    watch: false,
    registry,
  });
  let content = session.content;
  if (encoded) {
    const revision = sessionInternals(session).state.revision!;
    const collections: Record<string, EncodedCollection> = {};
    for (const [name, collection] of Object.entries(revision.collections)) {
      collections[name] = { records: collection.records.map(encode), payloads: {} };
    }
    content = createArtifactRuntime<typeof registry>(
      { version: ARTIFACT_VERSION, codec: CODEC_VERSION, collections: revision.registry },
      collections,
    );
  }
  return { content, session };
}

for (const encoded of [false, true]) {
  describe(`object/fluent parity, encoded=${encoded}`, () => {
    test("shares nested projection, filtering, tie-breaking, and pagination", async () => {
      const { content, session } = await setup(encoded);
      try {
        const object = await content.findMany("posts", {
          where: { draft: false, rank: { gte: 2 } },
          select: { id: true, title: true, author: { select: { name: true } } },
          orderBy: [{ rank: "desc" }],
          offset: 1,
          limit: 1,
        });
        const fluent = await content
          .query("posts")
          .where((fields) => operators.eq(fields.draft, false))
          .where((fields) => operators.gte(fields.rank, 2))
          .select("id", "title")
          .with("author", (author) => author.select("name"))
          .orderBy("rank", "desc")
          .offset(1)
          .limit(1)
          .all();
        expect(object).toEqual([{ id: "c", title: "Gamma", author: { name: "Ada" } }]);
        expect(fluent).toEqual(object);
        expect(
          await content
            .query("posts")
            .with("author", (author) => author.select("name"))
            .all(),
        ).toEqual(
          await content.findMany("posts", { select: { author: { select: { name: true } } } }),
        );
        expect(await content.count("posts", { where: { draft: false }, limit: 0 })).toBe(3);
        expect(
          await content.findFirst("posts", { where: { id: "missing" }, select: { id: true } }),
        ).toBeUndefined();
      } finally {
        await session.dispose();
      }
    });

    test("shares boolean, string, array, and presence predicates", async () => {
      const { content, session } = await setup(encoded);
      try {
        const cases = [
          [
            { title: { contains: "a", startsWith: "A", endsWith: "a" } },
            (fields: operators.Fields<{ title: string }>) =>
              operators.and(
                operators.contains(fields.title, "a"),
                operators.startsWith(fields.title, "A"),
                operators.endsWith(fields.title, "a"),
              ),
            ["a"],
          ],
          [
            { tags: { hasSome: ["one"] } },
            (fields: operators.Fields<{ tags: string[] }>) =>
              operators.arrayContainsAny(fields.tags, ["one"]),
            ["a"],
          ],
          [
            { optional: { isNull: true } },
            (fields: operators.Fields<{ optional: string | null | undefined }>) =>
              operators.isNull(fields.optional),
            ["b"],
          ],
          [
            { OR: [{ id: { in: ["a"] } }, { NOT: { draft: false } }] },
            (fields: operators.Fields<{ id: string; draft: boolean }>) =>
              operators.or(
                operators.inArray(fields.id, ["a"]),
                operators.not(operators.eq(fields.draft, false)),
              ),
            ["a", "d"],
          ],
        ] as const;
        for (const [where, predicate, expected] of cases) {
          const object = await content.findMany("posts", { where, select: { id: true } });
          const fluent = await content.query("posts").where(predicate).select("id").all();
          expect(object.map((entry) => entry.id)).toEqual(expected);
          expect(fluent).toEqual(object);
        }
      } finally {
        await session.dispose();
      }
    });

    test("selects inherited adjacency before pagination with ID-only shorthand", async () => {
      const { content, session } = await setup(encoded);
      try {
        const object = await content.findMany("posts", {
          where: { draft: false },
          select: { _adjacent: true },
          orderBy: [{ rank: "asc" }],
          offset: 1,
          limit: 1,
        });
        const fluent = await content
          .query("posts")
          .where((fields) => operators.eq(fields.draft, false))
          .orderBy("rank")
          .offset(1)
          .limit(1)
          .selectAdjacent()
          .all();
        expect(object).toEqual([{ _adjacent: { previous: { id: "a" }, next: { id: "c" } } }]);
        expect(fluent).toEqual(object);
      } finally {
        await session.dispose();
      }
    });

    test("uses an independent sibling scope for a single-entry lookup", async () => {
      const { content, session } = await setup(encoded);
      try {
        const object = await content.findFirst("posts", {
          where: { id: "b" },
          select: {
            title: true,
            _adjacent: {
              where: { draft: false },
              orderBy: [{ rank: "asc" }],
              select: { id: true, title: true },
            },
          },
        });
        const fluent = await content
          .query("posts")
          .where((fields) => operators.eq(fields.id, "b"))
          .select("title")
          .selectAdjacent((siblings) =>
            siblings
              .where((fields) => operators.eq(fields.draft, false))
              .orderBy("rank")
              .select("id", "title"),
          )
          .first();
        expect(object).toEqual({
          title: "Beta",
          _adjacent: { previous: { id: "a", title: "Alpha" }, next: { id: "c", title: "Gamma" } },
        });
        expect(fluent).toEqual(object);
        expect(
          await content.findFirst("posts", { where: { id: "a" }, select: { _adjacent: true } }),
        ).toEqual({ _adjacent: { previous: null, next: null } });
      } finally {
        await session.dispose();
      }
    });
  });
}
