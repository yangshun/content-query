import { describe, expect, test } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { schema } from "../schema.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { createArtifactRuntime } from "../internal.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import { eq, type QueryOptions, type CountOptions } from "../query.ts";
import type { Content } from "../runtime.ts";

/** Defines public consumer fixtures with nullable relationships and shared rich values. */
function definitions() {
  return {
    authors: defineCollection({
      loader: fixtureLoader(() => [{ id: "ada", data: { name: "Ada" } }]),
      schema: schema.object({ name: schema.string() }),
      relationships: {
        posts: {
          collection: "posts",
          type: "many",
          from: "id",
          to: "authorId",
          referenceSide: "to",
        },
      },
    }),
    posts: defineCollection({
      loader: fixtureLoader(() => [
        { id: "a", data: { title: "Alpha", draft: false, rank: 1, authorId: "ada" } },
        { id: "b", data: { title: "Beta", draft: false, rank: 2 } },
        { id: "c", data: { title: "Draft", draft: true, rank: 3, authorId: "ada" } },
      ]),
      schema: schema.object({
        title: schema.string(),
        draft: schema.boolean(),
        rank: schema.number(),
        authorId: schema.string().optional(),
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
}

/** Exercises the same typed API against development data and encoded production records. */
async function setup(encoded: boolean) {
  const registry = definitions();
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
  describe(`relational queries, encoded=${encoded}`, () => {
    test("executes SQL-ordered selections with inferred fields and immutable reuse", async () => {
      const { content, session } = await setup(encoded);
      try {
        const selection = content.select("id");
        expect(await selection.from("authors")).toEqual([{ id: "ada" }]);
        const posts = selection.from("posts").where((fields) => eq(fields.draft, false));
        expect(await posts.limit(1)).toEqual([{ id: "a" }]);
        expect(await posts.offset(1).execute()).toEqual([{ id: "b" }]);
        expect(await posts).toEqual([{ id: "a" }, { id: "b" }]);
        expect(await content.select().from("authors")).toEqual([{ id: "ada", name: "Ada" }]);
        expect(() => content.select("id", "id").from("posts")).toThrow(/distinct/);
        expect(() => content.select("id").from("missing" as "posts")).toThrow(/collection/);
      } finally {
        await session.dispose();
      }
    });
    test("selects columns and relationships with filtering, ordering, and pagination", async () => {
      const { content, session } = await setup(encoded);
      try {
        const result = await content.query.posts.findMany({
          columns: { id: true, title: true },
          where: { draft: false, rank: { gte: 1 } },
          with: { author: { columns: { name: true } } },
          orderBy: { rank: "desc" },
          offset: 0,
          limit: 2,
        });
        expect(result).toEqual([
          { id: "b", title: "Beta", author: null },
          { id: "a", title: "Alpha", author: { name: "Ada" } },
        ]);
        expect(
          await content.query.posts.findFirst({ columns: { id: true }, where: { id: "missing" } }),
        ).toBeUndefined();
        expect(
          await content.query.posts.findFirst({ columns: { title: true }, where: { id: "a" } }),
        ).toEqual({ title: "Alpha" });
      } finally {
        await session.dispose();
      }
    });
    test("defaults to metadata and supports exclusions and relationship-only selection", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect((await content.query.posts.findMany()).length).toBe(3);
        expect(await content.query.authors.findFirst()).toEqual({ id: "ada", name: "Ada" });
        expect(await content.query.posts.findFirst({ where: { id: "a" } })).toEqual({
          id: "a",
          title: "Alpha",
          draft: false,
          rank: 1,
          authorId: "ada",
        });
        expect(
          await content.query.posts.findFirst({
            where: { id: "a" },
            columns: { rank: false, draft: false },
          }),
        ).toEqual({ id: "a", title: "Alpha", authorId: "ada" });
        expect(
          await content.query.posts.findFirst({
            where: { id: "a" },
            columns: {},
            with: { author: true },
          }),
        ).toEqual({ author: { id: "ada", name: "Ada" } });
        expect(
          await content.query.posts.findFirst({
            where: { id: "a" },
            columns: { title: true, id: false },
            with: { author: false },
          }),
        ).toEqual({ title: "Alpha" });
        const missingAuthor = await content.query.posts.findFirst({ where: { id: "b" } });
        expect(missingAuthor).toEqual({ id: "b", title: "Beta", draft: false, rank: 2 });
        expect(Object.hasOwn(missingAuthor!, "authorId")).toBe(false);
        const includedAuthor = await content.query.posts.findFirst({
          where: { id: "b" },
          columns: { authorId: true },
        });
        expect(includedAuthor).toEqual({ authorId: undefined });
        expect(Object.hasOwn(includedAuthor!, "authorId")).toBe(true);
        expect(await content.query.posts.findFirst({ where: { id: "a" }, columns: {} })).toEqual(
          {},
        );
      } finally {
        await session.dispose();
      }
    });
    test("filters parents by related entries independently from included relationship filters", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: { author: { name: { eq: "Ada" } } },
          }),
        ).toEqual([{ id: "a" }, { id: "c" }]);
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: { NOT: { author: true } },
          }),
        ).toEqual([{ id: "b" }]);
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: { author: true },
            with: { author: { columns: { name: true }, where: { name: { ne: "Ada" } } } },
          }),
        ).toEqual([
          { id: "a", author: null },
          { id: "c", author: null },
        ]);
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: {
              AND: [
                { OR: [{ rank: { gt: 1 } }, { title: { ilike: "a%" } }] },
                { NOT: { draft: true } },
              ],
            },
            orderBy: { id: "asc" },
          }),
        ).toEqual([{ id: "a" }, { id: "b" }]);
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: { rank: { OR: [{ lt: 2 }, { eq: 3 }] } },
          }),
        ).toEqual([{ id: "a" }, { id: "c" }]);
      } finally {
        await session.dispose();
      }
    });
    test("pages each included collection independently from parent relationship filters", async () => {
      const { content, session } = await setup(encoded);
      try {
        const authors = await content.query.authors.findMany({
          columns: { name: true },
          where: { posts: { draft: true } },
          with: {
            posts: {
              columns: { id: true },
              orderBy: { rank: "desc" },
              offset: 1,
              limit: 1,
              with: { author: { columns: { name: true } } },
            },
          },
        });
        expect(authors).toEqual([{ name: "Ada", posts: [{ id: "a", author: { name: "Ada" } }] }]);
      } finally {
        await session.dispose();
      }
    });
    test("retains explicit sibling scopes across both query styles", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect(
          await content.query.posts.findFirst({
            where: { id: "b" },
            columns: { title: true },
            adjacent: {
              where: { draft: false },
              columns: { id: true, title: true },
              orderBy: { title: "asc" },
            },
          }),
        ).toEqual({
          title: "Beta",
          _adjacent: { previous: { id: "a", title: "Alpha" }, next: null },
        });
        expect(
          await content.query.posts.findFirst({ where: { id: "a" }, adjacent: true }),
        ).toMatchObject({ _adjacent: { previous: null, next: null } });
        expect(
          await content
            .select("id")
            .from("posts")
            .where((fields) => eq(fields.id, "a"))
            .first(),
        ).toEqual({ id: "a" });
        expect(
          await content.query.posts.findMany({ columns: { id: true }, where: { id: "a" } }),
        ).toEqual([{ id: "a" }]);
      } finally {
        await session.dispose();
      }
    });
    test("rejects malformed column, relationship, and scope options", async () => {
      const { content, session } = await setup(encoded);
      try {
        for (const options of [
          null,
          [],
          { columns: [] },
          { columns: { title: 1 } },
          { columns: { author: true } },
          { with: { missing: true } },
          { with: { author: { limit: 1 } } },
          { where: { rank: { typo: 1 } } },
          { adjacent: { limit: 1 } },
          { adjacent: { adjacent: true } },
          { typo: true },
        ]) {
          expect(() => content.query.posts.findMany(options as never)).toThrow();
        }
        expect(Object.keys(content.query)).toContain("posts");
      } finally {
        await session.dispose();
      }
    });
  });
}

/** Checks the public relational API's selected result types and recursive option validation. */
async function checkTypes(content: Content<ReturnType<typeof definitions>>) {
  const options = {
    columns: { title: true },
    where: { draft: false },
  } as const satisfies QueryOptions<ReturnType<typeof definitions>, "posts">;
  const typedRows: { title: string }[] = await content.query.posts.findMany(options);
  const countOptions: CountOptions<ReturnType<typeof definitions>, "posts"> = {
    where: { draft: false },
  };
  const typedCount: number = await content.count("posts", countOptions);
  void [typedRows, typedCount];
  const selection = content.select("id", "title");
  const rows: { id: string; title: string }[] = await selection.from("posts").limit(1);
  void rows;
  // @ts-expect-error Deferred fields are validated once the collection is supplied.
  content.select("typo").from("posts");
  // @ts-expect-error from() is available only after select().
  content.from("posts");
  // @ts-expect-error query is a collection namespace, not a callable builder.
  content.query("posts");
  // @ts-expect-error Relational entry points live under their collection namespace.
  content.findMany("posts", {});
  const selected = await content.query.posts.findMany({
    columns: { title: true },
    with: { author: { columns: { name: true } } },
  });
  const title: string = selected[0]!.title;
  const name: string | undefined = selected[0]!.author?.name;
  void [title, name];
  // @ts-expect-error Unselected root columns are excluded from the result.
  void selected[0]!.id;
  // @ts-expect-error Unselected related columns are excluded from the result.
  void selected[0]!.author?.id;
  // @ts-expect-error Collection names are inferred from the configured registry.
  void content.query.missing;
  // @ts-expect-error Relationships are selected through with, not columns.
  void content.query.posts.findMany({ columns: { author: true } });
  // @ts-expect-error Recursive filters retain each field's type.
  void content.query.posts.findMany({ where: { rank: { eq: "1" } } });
  // @ts-expect-error Unknown nested operators are rejected even alongside valid operators.
  void content.query.posts.findMany({ where: { rank: { eq: 1, typo: 2 } } });
  // @ts-expect-error Singular relationships cannot be paginated.
  void content.query.posts.findMany({ with: { author: { columns: { name: true }, limit: 1 } } });
  // @ts-expect-error Related filters use the related collection's schema.
  void content.query.posts.findMany({ where: { author: { name: { gt: 1 } } } });
  const all = await content.query.posts.findMany();
  const optionalMetadata: (typeof all)[number] = { id: "b", title: "Beta", draft: false, rank: 2 };
  void optionalMetadata;
  const authors = await content.query.authors.findMany({ with: { posts: true } });
  const nestedMetadata: (typeof authors)[number]["posts"][number] = optionalMetadata;
  void nestedMetadata;
  const rank: number = all[0]!.rank;
  void rank;
  const excluded = await content.query.posts.findMany({ columns: { rank: false } });
  // @ts-expect-error Excluded columns are absent from the result.
  void excluded[0]!.rank;
}
void checkTypes;
