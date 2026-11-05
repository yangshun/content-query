import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { eq, type CursorPage, type NumberedPage } from "../query.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import type { ContentError } from "../shared/errors.ts";
import { loadAll, loadArtifact } from "../../tests/helpers/collections.ts";

/** Builds the same consumer over live and production-encoded data with null and date sort keys. */
async function setup(encoded: boolean) {
  const day = (date: number) => new Date(Date.UTC(2026, 0, date));
  const registry = {
    authors: defineCollection({
      loader: fixtureLoader(() => [{ id: "ada", data: { name: "Ada" } }]),
      schema: z.object({ name: z.string() }),
    }),
    posts: defineCollection({
      loader: fixtureLoader(() => [
        { id: "a", data: { score: 3, publishedAt: day(1), draft: false, authorId: "ada" } },
        { id: "b", data: { score: null, publishedAt: day(2), draft: false, authorId: "ada" } },
        { id: "c", data: { score: 1, publishedAt: day(3), draft: false, authorId: "ada" } },
        { id: "d", data: { score: 3, publishedAt: day(4), draft: true, authorId: "ada" } },
        { id: "e", data: { publishedAt: day(5), draft: false, authorId: "ada" } },
        { id: "f", data: { score: 2, publishedAt: day(6), draft: false, authorId: "ada" } },
        { id: "g", data: { score: 5, publishedAt: day(7), draft: false, authorId: "ada" } },
      ]),
      schema: z.object({
        score: z.number().nullish(),
        publishedAt: z.date(),
        draft: z.boolean(),
        authorId: z.string(),
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
  let content = loadAll(session.collections);
  if (encoded) {
    const revision = sessionInternals(session).state.revision!;
    const collections: Record<string, EncodedCollection> = {};
    for (const [name, collection] of Object.entries(revision.collections)) {
      collections[name] = { records: collection.records.map(encode), builtins: {} };
    }
    content = loadArtifact<typeof registry>(
      { version: ARTIFACT_VERSION, codec: CODEC_VERSION, collections: revision.registry },
      collections,
    );
  }
  return { content, session };
}

/** Reads the code of the ContentError that a synchronous call throws. */
function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as ContentError).code;
  }
  return undefined;
}

/** Collects the IDs of a page's items. */
function ids(page: { items: readonly { id: string }[] }): string[] {
  return page.items.map((item) => item.id);
}

for (const encoded of [false, true]) {
  describe(`paginate, encoded=${encoded}`, () => {
    describe("page numbers", () => {
      test("returns pages with totals, matching across query styles", async () => {
        const { content, session } = await setup(encoded);
        try {
          // Score descending puts null and missing scores last, then breaks ties by ID.
          const query = content.posts
            .select("id")
            .where((fields) => eq(fields.draft, false))
            .orderBy("score", "desc");
          const first = await query.paginate({ page: 1, size: 4 });
          expectTypeOf(first).toEqualTypeOf<NumberedPage<{ id: string }>>();
          expect(first).toEqual({
            items: [{ id: "g" }, { id: "a" }, { id: "f" }, { id: "c" }],
            total: 6,
            page: 1,
            pageCount: 2,
            hasNextPage: true,
            hasPreviousPage: false,
          });
          const second = await query.paginate({ page: 2, size: 4 });
          expect(second).toEqual({
            items: [{ id: "b" }, { id: "e" }],
            total: 6,
            page: 2,
            pageCount: 2,
            hasNextPage: false,
            hasPreviousPage: true,
          });
          const relational = await content.posts.paginate({
            columns: { id: true },
            where: { draft: false },
            orderBy: { score: "desc" },
            page: 2,
            size: 4,
          });
          expectTypeOf(relational).toEqualTypeOf<NumberedPage<{ id: string }>>();
          expect(relational).toEqual(second);
        } finally {
          await session.dispose();
        }
      });

      test("returns empty pages past the end and a first page when nothing matches", async () => {
        const { content, session } = await setup(encoded);
        try {
          expect(await content.posts.select("id").paginate({ page: 3, size: 4 })).toEqual({
            items: [],
            total: 7,
            page: 3,
            pageCount: 2,
            hasNextPage: false,
            hasPreviousPage: true,
          });
          expect(
            await content.posts.paginate({
              columns: { id: true },
              where: { id: "missing" },
              page: 1,
              size: 4,
            }),
          ).toEqual({
            items: [],
            total: 0,
            page: 1,
            pageCount: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          });
        } finally {
          await session.dispose();
        }
      });

      test("includes relationships and results-scope neighbors before pagination", async () => {
        const { content, session } = await setup(encoded);
        try {
          const page = await content.posts
            .select("id")
            .with("author", (author) => author.select("name"))
            .selectAdjacent("id")
            .orderBy("publishedAt")
            .paginate({ page: 2, size: 2 });
          expect(page.items).toEqual([
            {
              id: "c",
              author: { name: "Ada" },
              _adjacent: { previous: { id: "b" }, next: { id: "d" } },
            },
            {
              id: "d",
              author: { name: "Ada" },
              _adjacent: { previous: { id: "c" }, next: { id: "e" } },
            },
          ]);
        } finally {
          await session.dispose();
        }
      });
    });

    describe("cursors", () => {
      test("walks forward and backward across null sort values", async () => {
        const { content, session } = await setup(encoded);
        try {
          const query = content.posts
            .select("id")
            .where((fields) => eq(fields.draft, false))
            .orderBy("score", "desc");
          const first = await query.paginate({ size: 4 });
          expectTypeOf(first).toEqualTypeOf<CursorPage<{ id: string }>>();
          expect(ids(first)).toEqual(["g", "a", "f", "c"]);
          expect(first).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
          expect("total" in first).toBe(false);
          const second = await query.paginate({ size: 4, after: first.endCursor });
          expect(ids(second)).toEqual(["b", "e"]);
          expect(second).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
          expect(await query.paginate({ size: 4, before: second.startCursor })).toEqual(first);
          expect(await query.paginate({ size: 4, after: null })).toEqual(first);

          const walked: string[] = [];
          let cursor: string | null = null;
          let hasNextPage = true;
          while (hasNextPage) {
            const page: CursorPage<{ id: string }> = await query.paginate({
              size: 2,
              after: cursor,
            });
            walked.push(...ids(page));
            cursor = page.endCursor;
            hasNextPage = page.hasNextPage;
          }
          expect(walked).toEqual(ids({ items: await query.all() }));
        } finally {
          await session.dispose();
        }
      });

      test("starts from the end, adds totals on request, and shares cursors across styles", async () => {
        const { content, session } = await setup(encoded);
        try {
          const query = content.posts.select("id").orderBy("publishedAt", "desc");
          const last = await query.paginate({ size: 3, before: null, total: true });
          expectTypeOf(last.total).toEqualTypeOf<number>();
          expect(ids(last)).toEqual(["c", "b", "a"]);
          expect(last).toMatchObject({ total: 7, hasNextPage: false, hasPreviousPage: true });
          const relational = await content.posts.paginate({
            columns: { id: true },
            orderBy: { publishedAt: "desc" },
            size: 3,
            before: last.startCursor,
          });
          expect(ids(relational)).toEqual(["f", "e", "d"]);
          expect(relational).toMatchObject({ hasNextPage: true, hasPreviousPage: true });
        } finally {
          await session.dispose();
        }
      });

      test("positions by sort values when the boundary entry no longer matches", async () => {
        const { content, session } = await setup(encoded);
        try {
          const all = await content.posts.select("id").orderBy("publishedAt").paginate({ size: 4 });
          expect(ids(all)).toEqual(["a", "b", "c", "d"]);
          // The cursor points at the draft "d", which the filtered query excludes.
          const published = content.posts
            .select("id")
            .where((fields) => eq(fields.draft, false))
            .orderBy("publishedAt");
          const next = await published.paginate({ size: 4, after: all.endCursor });
          expect(ids(next)).toEqual(["e", "f", "g"]);
          expect(await published.paginate({ size: 4, after: next.endCursor })).toEqual({
            items: [],
            startCursor: null,
            endCursor: null,
            hasNextPage: false,
            hasPreviousPage: true,
          });
        } finally {
          await session.dispose();
        }
      });

      test("rejects cursors from another order or collection, and malformed cursors", async () => {
        const { content, session } = await setup(encoded);
        try {
          const page = await content.posts.select("id").paginate({ size: 2 });
          const reordered = content.posts.select("id").orderBy("publishedAt");
          expect(thrownCode(() => reordered.paginate({ size: 2, after: page.endCursor }))).toBe(
            "invalid-cursor",
          );
          expect(
            thrownCode(() =>
              content.authors.paginate({
                columns: { id: true },
                size: 2,
                before: page.endCursor,
              }),
            ),
          ).toBe("invalid-cursor");
          for (const cursor of ["not a cursor", "AAAA", page.endCursor!.slice(1)]) {
            expect(
              thrownCode(() => content.posts.select("id").paginate({ size: 2, after: cursor })),
            ).toBe("invalid-cursor");
          }
        } finally {
          await session.dispose();
        }
      });
    });

    describe("invalid requests", () => {
      test("rejects conflicting options and manual pagination in both styles", async () => {
        const { content, session } = await setup(encoded);
        try {
          const query = content.posts.select("id");
          const invalid = [
            // @ts-expect-error Page numbers cannot be combined with cursors.
            () => query.paginate({ page: 1, size: 2, after: "cursor" }),
            // @ts-expect-error A cursor page reads after or before, not both.
            () => query.paginate({ size: 2, after: "cursor", before: "cursor" }),
            // @ts-expect-error Page results always include total.
            () => query.paginate({ page: 1, size: 2, total: true }),
            // @ts-expect-error Unknown options are rejected.
            () => query.paginate({ page: 1, size: 2, limit: 1 }),
            () => query.paginate({ page: 0, size: 2 }),
            () => query.paginate({ page: 1, size: 0 }),
            () => query.paginate({ size: 2.5 }),
            () => query.paginate({ size: 2, total: "yes" as never }),
            () => query.paginate(undefined as never),
            // @ts-expect-error paginate() sets the limit and offset itself.
            () => query.limit(2).paginate({ page: 1, size: 2 }),
            // @ts-expect-error The restriction survives later clauses.
            () => query.offset(2).orderBy("score").paginate({ page: 1, size: 2 }),
            // @ts-expect-error Unselected queries cannot run.
            () => content.posts.paginate({ page: 1, size: 2 }),
            () =>
              content.posts.paginate({
                columns: { id: true },
                page: 1,
                size: 2,
                // @ts-expect-error Relational paginate() owns limit and offset.
                limit: 1,
              }),
            () =>
              // @ts-expect-error Relational paginate() still requires a selection.
              content.posts.paginate({ page: 1, size: 2 }),
            () => content.posts.paginate(undefined as never),
          ];
          for (const run of invalid) {
            expect(thrownCode(run)).toBe("invalid-query");
          }
        } finally {
          await session.dispose();
        }
      });

      test("keeps paginate() off nested relationship builders", async () => {
        const { content, session } = await setup(encoded);
        try {
          let nested: string | undefined;
          await content.posts
            .select("id")
            .with("author", (author) => {
              const selected = author.select("name");
              nested = thrownCode(() =>
                (selected as unknown as { paginate(options: unknown): unknown }).paginate({
                  page: 1,
                  size: 1,
                }),
              );
              return selected;
            })
            .first();
          expect(nested).toBe("invalid-query");
        } finally {
          await session.dispose();
        }
      });
    });
  });
}
