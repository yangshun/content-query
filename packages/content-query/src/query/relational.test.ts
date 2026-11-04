import { describe, expect, test } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { schema } from "../schema.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { createArtifactRuntime } from "../internal.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import { eq, has, like, type QueryOptions, type CountOptions } from "../query.ts";
import { file, type BodyLoader } from "../loaders.ts";
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
      collections[name] = { records: collection.records.map(encode), builtins: {} };
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
    test("executes collection-first selections with inferred fields and immutable reuse", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect(await content.from("authors").select("id")).toEqual([{ id: "ada" }]);
        const published = content.from("posts").where((fields) => eq(fields.draft, false));
        const ids = published.select("id");
        expect(await ids.limit(1)).toEqual([{ id: "a" }]);
        expect(await ids.offset(1).execute()).toEqual([{ id: "b" }]);
        expect(await ids).toEqual([{ id: "a" }, { id: "b" }]);
        expect(await published.select("title").first()).toEqual({ title: "Alpha" });
        expect(await published.count()).toBe(2);
        expect(() => content.from("posts").select("id", "id")).toThrow(/distinct/);
        expect(() => content.from("missing" as "posts")).toThrow(/collection/);
      } finally {
        await session.dispose();
      }
    });
    test("selects nothing implicitly in fluent queries, not even id", async () => {
      const { content, session } = await setup(encoded);
      try {
        const unselected = content.from("posts").where((fields) => eq(fields.draft, false));
        const runUnselected = unselected as unknown as {
          all(): Promise<unknown>;
          first(): Promise<unknown>;
          execute(): Promise<unknown>;
        };
        for (const terminal of ["all", "first", "execute"] as const) {
          expect(() => runUnselected[terminal]()).toThrow(/Select fields/);
        }
        await expect(unselected as unknown as Promise<unknown>).rejects.toMatchObject({
          code: "invalid-query",
          message: expect.stringMatching(/Select fields/),
        });
        expect(await unselected.count()).toBe(2);
        expect(
          await content
            .from("posts")
            .where((fields) => eq(fields.id, "a"))
            .with("author", (author) => author.select("name"))
            .first(),
        ).toEqual({ author: { name: "Ada" } });
        expect(() =>
          content
            .from("posts")
            .with("author", (author) => author.where((fields) => eq(fields.name, "Ada")) as never),
        ).toThrow(/explicitly selected/);
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
    test("selects nothing implicitly in relational queries, not even id", async () => {
      const { content, session } = await setup(encoded);
      try {
        const findFirst = (options?: unknown) => content.query.posts.findFirst(options as never);
        for (const options of [
          undefined,
          {},
          { where: { id: "a" } },
          { where: { id: "a" }, columns: {} },
          { columns: { id: true }, with: { author: { columns: {} } } },
          { columns: { id: true }, adjacent: { orderBy: { rank: "asc" } } },
        ]) {
          expect(() => findFirst(options)).toThrow(/Select fields/);
        }
        expect(() => findFirst({ columns: { title: true, rank: false } })).toThrow(/Columns list/);
        expect(() => findFirst({ columns: { id: true }, with: { author: true } })).toThrow(
          /requires nested options/,
        );
        expect(await content.count("posts", { where: { draft: false } })).toBe(2);
      } finally {
        await session.dispose();
      }
    });
    test("returns exactly the selected columns, relationships, and payloads", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect(
          await content.query.posts.findFirst({
            where: { id: "a" },
            with: { author: { columns: { name: true } } },
          }),
        ).toEqual({ author: { name: "Ada" } });
        expect(
          await content.query.posts.findFirst({
            where: { id: "a" },
            columns: { title: true },
            with: { author: false },
          }),
        ).toEqual({ title: "Alpha" });
        const includedAuthor = await content.query.posts.findFirst({
          where: { id: "b" },
          columns: { authorId: true },
        });
        expect(includedAuthor).toEqual({ authorId: undefined });
        expect(Object.hasOwn(includedAuthor!, "authorId")).toBe(true);
        expect(
          await content.query.posts.findMany({
            where: { draft: false },
            orderBy: { rank: "asc" },
            columns: {},
            adjacent: { scope: "results", columns: { title: true } },
          }),
        ).toEqual([
          { _adjacent: { previous: null, next: { title: "Beta" } } },
          { _adjacent: { previous: { title: "Alpha" }, next: null } },
        ]);
      } finally {
        await session.dispose();
      }
    });
    test("selects results-scope neighbors explicitly, including within a relationship", async () => {
      const { content, session } = await setup(encoded);
      try {
        const expected = {
          name: "Ada",
          posts: [
            { id: "a", _adjacent: { previous: null, next: { title: "Draft" } } },
            { id: "c", _adjacent: { previous: { title: "Alpha" }, next: null } },
          ],
        };
        expect(
          await content.query.authors.findFirst({
            columns: { name: true },
            with: {
              posts: {
                columns: { id: true },
                orderBy: { rank: "asc" },
                adjacent: { scope: "results", columns: { title: true } },
              },
            },
          }),
        ).toEqual(expected);
        expect(
          await content
            .from("authors")
            .select("name")
            .with("posts", (posts) => posts.select("id").orderBy("rank").selectAdjacent("title"))
            .first(),
        ).toEqual(expected);
        const findMany = (options: unknown) => content.query.posts.findMany(options as never);
        expect(() => findMany({ columns: { id: true }, adjacent: true })).toThrow(
          /select their own data/,
        );
        expect(() =>
          findMany({
            columns: { id: true },
            adjacent: { scope: "results", columns: { id: true }, where: { draft: false } },
          }),
        ).toThrow(/share the query's filters and order/);
        const unselectedNeighbors = content.from("posts").select("id") as unknown as {
          selectAdjacent(...fields: unknown[]): unknown;
        };
        expect(() => unselectedNeighbors.selectAdjacent()).toThrow(/neighbor fields/);
        expect(() => unselectedNeighbors.selectAdjacent("id", 1)).toThrow(/neighbor fields/);
      } finally {
        await session.dispose();
      }
    });
    test("retains relationship filter scope when an ID lookup selects one candidate", async () => {
      const { content, session } = await setup(encoded);
      try {
        expect(
          await content.query.posts.findFirst({
            columns: { id: true },
            where: { id: "a", author: { name: { eq: "Ada" } } },
          }),
        ).toEqual({ id: "a" });
        expect(
          await content.query.posts.findFirst({
            columns: { id: true },
            where: { id: "a", author: { name: { eq: "Grace" } } },
          }),
        ).toBeUndefined();
        expect(
          await content.query.posts.findMany({
            columns: { id: true },
            where: { id: "missing", author: { name: { eq: "Ada" } } },
          }),
        ).toEqual([]);
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
          await content.query.posts.findFirst({
            where: { id: "a" },
            adjacent: { scope: "results", columns: { id: true } },
          }),
        ).toMatchObject({ _adjacent: { previous: null, next: null } });
        expect(
          await content
            .from("posts")
            .select("id")
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
  const posts = content.from("posts");
  const rows: { id: string; title: string }[] = await posts.select("id", "title").limit(1);
  void rows;
  // @ts-expect-error Field names are checked as soon as the collection is known.
  content.from("posts").select("typo");
  // @ts-expect-error Awaiting an unselected query fails to compile.
  await posts; // oxlint-disable-line typescript-eslint/await-thenable
  // @ts-expect-error Unselected queries have no runnable terminals.
  void posts.all();
  // @ts-expect-error Filters alone select nothing.
  void posts.where((fields) => eq(fields.draft, false)).first();
  const total: number = await posts.count();
  void total;
  // @ts-expect-error Row-returning relational queries must select data.
  void content.query.posts.findMany();
  // @ts-expect-error Filters alone select nothing, not even id.
  void content.query.posts.findFirst({ where: { id: "a" } });
  // @ts-expect-error An empty column list selects nothing on its own.
  void content.query.posts.findMany({ columns: {} });
  // @ts-expect-error Columns only include fields; there are no exclusions.
  void content.query.posts.findMany({ columns: { rank: false } });
  // @ts-expect-error Relationships select their own data.
  void content.query.posts.findMany({ columns: { id: true }, with: { author: true } });
  // @ts-expect-error A relationship scope must select data too.
  void content.query.posts.findMany({ columns: { id: true }, with: { author: { columns: {} } } });
  const relatedOnly = await content.query.posts.findMany({
    with: { author: { columns: { name: true } } },
  });
  const relatedName: string | undefined = relatedOnly[0]!.author?.name;
  void relatedName;
  // @ts-expect-error Unselected fields, including id, are absent from the result.
  void relatedOnly[0]!.id;
  // @ts-expect-error Fluent neighbors select their own fields.
  void posts.select("id").selectAdjacent();
  // @ts-expect-error Relational neighbors select their own data.
  void content.query.posts.findMany({ columns: { id: true }, adjacent: true });
  void content.query.posts.findMany({
    columns: { id: true },
    // @ts-expect-error Results-scope neighbors share the query's filters and order.
    adjacent: { scope: "results", columns: { id: true }, orderBy: { rank: "asc" } },
  });
  const neighbors = await content.query.posts.findMany({
    columns: { id: true },
    adjacent: { scope: "results", columns: { title: true } },
  });
  const neighborTitle: string | undefined = neighbors[0]!._adjacent.next?.title;
  const fluentNeighbors = await posts.select("id").selectAdjacent("title", "rank").all();
  const neighborRank: number | undefined = fluentNeighbors[0]!._adjacent.previous?.rank;
  void [neighborTitle, neighborRank];
  // @ts-expect-error Neighbor selections include only the named fields.
  void neighbors[0]!._adjacent.next?.id;
  void posts.where((fields) => has(fields.author, (author) => eq(author.name, "Ada")));
  void posts.where((fields) => like(fields.title, "A%"));
  // @ts-expect-error has() accepts only relationships.
  void posts.where((fields) => has(fields.title));
  // @ts-expect-error like() requires a string field.
  void posts.where((fields) => like(fields.rank, "1%"));
  // @ts-expect-error Related filters use the related collection's fields.
  void posts.where((fields) => has(fields.author, (author) => eq(author.title, "Alpha")));
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
  const authors = await content.query.authors.findMany({
    with: { posts: { columns: { title: true, rank: true } } },
  });
  const nestedRank: number = authors[0]!.posts[0]!.rank;
  void nestedRank;
  const optional = await content.query.posts.findMany({ columns: { authorId: true } });
  const authorId: string | undefined = optional[0]!.authorId;
  void authorId;
  const withPayloads = await content.query.posts.findFirst({
    columns: { title: true },
    payloads: { _body: true, _rendered: true },
    with: { author: { columns: { name: true }, payloads: { _body: true } } },
  });
  const body: string | undefined = withPayloads!._payloads._body;
  const html: string = withPayloads!._payloads._rendered.html;
  const authorBody: string | undefined = withPayloads!.author?._payloads._body;
  void [body, html, authorBody];
  const omitted = await content.query.posts.findMany({
    columns: { id: true },
    payloads: { _body: false },
  });
  // @ts-expect-error Payloads set to false add no _payloads key.
  void omitted[0]!._payloads;
  // @ts-expect-error A payload set to false selects nothing.
  void content.query.posts.findMany({ payloads: { _body: false } });
  const payloadOnly = await content.query.posts.findFirst({
    where: { id: "a" },
    payloads: { _rendered: true },
  });
  const payloadHtml: string | undefined = payloadOnly?._payloads._rendered.html;
  void payloadHtml;
  // @ts-expect-error Unknown payload names are rejected.
  void content.query.posts.findMany({ payloads: { missing: true } });
  void content.query.posts.findMany({
    // @ts-expect-error Adjacent sibling scopes cannot request payloads.
    adjacent: { columns: { id: true }, payloads: { _body: true } },
  });
  // @ts-expect-error Counts cannot request payloads.
  void content.count("posts", { payloads: { _body: true } });
  const fluent = await content
    .from("posts")
    .select("id")
    .withPayload("_rendered")
    .withPayload("_body")
    .first();
  const fluentHtml: string | undefined = fluent?._payloads._rendered.html;
  const fluentBody: string | undefined = fluent?._payloads._body;
  void [fluentHtml, fluentBody];
  // @ts-expect-error Unknown fluent payload names are rejected.
  content.from("posts").select("id").withPayload("missing");
  // @ts-expect-error Counting is unavailable once payloads are requested.
  void content.from("posts").select("id").withPayload("_body").count();
}
void checkTypes;

/** Declares collections whose entries are data records, or bodies without rendered output. */
function recordDefinitions() {
  const title = schema.object({ title: schema.string() });
  const bodies = fixtureLoader(() => []) as BodyLoader;
  return {
    settings: defineCollection({ loader: file("./settings.json"), schema: title }),
    notes: defineCollection({ loader: bodies, schema: title }),
    data: defineCollection({ source: { type: "json", directory: "./data" }, schema: title }),
    pages: defineCollection({ source: "./pages", schema: title }),
  };
}

/** Checks that built-in payloads are offered only where entries can carry them. */
async function checkRecordTypes(content: Content<ReturnType<typeof recordDefinitions>>) {
  // @ts-expect-error file() collections carry no built-in payloads.
  void content.query.settings.findMany({ payloads: { _body: true } });
  // @ts-expect-error JSON sources carry no built-in payloads.
  void content.query.data.findMany({ payloads: { _rendered: true } });
  // @ts-expect-error Fluent queries follow the same availability.
  content.from("data").select("id").withPayload("_body");
  const page = await content.query.pages.findFirst({ payloads: { _rendered: true } });
  const pageHtml: string | undefined = page?._payloads._rendered.html;
  // @ts-expect-error Body loaders carry no built-in rendered output.
  void content.query.notes.findMany({ payloads: { _rendered: true } });
  // @ts-expect-error Fluent queries reject rendered output from body loaders too.
  content.from("notes").select("id").withPayload("_rendered");
  const note = await content.query.notes.findFirst({ payloads: { _body: true } });
  const noteBody: string | undefined = note?._payloads._body;
  const fluentNote = await content.from("notes").select("id").withPayload("_body").first();
  const fluentNoteBody: string | undefined = fluentNote?._payloads._body;
  void [pageHtml, noteBody, fluentNoteBody];
}
void checkRecordTypes;
