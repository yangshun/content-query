import path from "node:path";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "../collection/define.ts";
import type { CollectionDefinition } from "../collection/types.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import {
  and,
  arrayContains,
  arrayContainsAll,
  arrayContainsAny,
  contains,
  eq,
  gt,
  inArray,
  isMissing,
  isNull,
  isUndefined,
  not,
  notInArray,
  or,
} from "../query.ts";
import { createArtifactRuntime } from "../internal.ts";
import { encode } from "../shared/values.ts";
import { ContentError } from "../shared/errors.ts";
import { ARTIFACT_VERSION, CODEC_VERSION, type EncodedCollection } from "../artifacts/types.ts";
import type { Content, QueryStyle } from "../runtime.ts";
import type { ContentSession } from "../preparation/session.ts";

/** Builds typed fixtures covering scalars, absence, rendering, and relationship directions. */
function fixture() {
  const authors = defineCollection({
    loader: fixtureLoader(() => [
      { id: "ada", data: { name: "Ada", featured: ["second", "first", "second"] } },
      { id: "grace", data: { name: "Grace", featured: [] } },
    ]),
    schema: z.object({ name: z.string(), featured: z.array(z.string()) }),
    relationships: {
      posts: { collection: "posts", type: "many", from: "id", to: "authorId", referenceSide: "to" },
      featuredPosts: {
        collection: "posts",
        type: "many",
        from: "featured",
        to: "id",
        referenceSide: "from",
      },
    },
  });
  const posts = defineCollection({
    loader: fixtureLoader(() => [
      {
        id: "first",
        data: {
          title: "Alpha%_",
          authorId: "ada",
          score: 1,
          date: new Date(1),
          tags: ["a", "b"],
          optional: undefined,
        },
        body: "raw",
        rendered: {
          html: '<h2 id="hello">Hello</h2>',
          metadata: { headings: [{ depth: 2, slug: "hello", text: "Hello" }] },
        },
      },
      {
        id: "second",
        data: {
          title: "Beta",
          authorId: "ada",
          score: 2,
          date: new Date(2),
          tags: ["b"],
          optional: null,
        },
      },
      { id: "third", data: { title: "Gamma", score: NaN, date: new Date(NaN), tags: [] } },
    ]),
    schema: z.object({
      title: z.string(),
      authorId: z.string().optional(),
      score: z.custom<number>(),
      date: z.date().or(z.custom<Date>((value) => value instanceof Date)),
      tags: z.array(z.string()),
      optional: z.string().nullable().optional(),
    }),
    computed: { upper: { schema: z.string(), resolve: ({ data }) => data.title.toUpperCase() } },
    relationships: {
      author: {
        collection: "authors",
        type: "one",
        from: "authorId",
        to: "id",
        referenceSide: "from",
      },
    },
  });
  return { authors, posts };
}

for (const backend of ["in-memory", "encoded"] as const) {
  describe(`${backend} conformance`, () => {
    /** Prepares once, then optionally crosses the actual encoded-module data boundary. */
    async function prepared<Registry extends Record<string, CollectionDefinition>>(
      registry: Registry,
    ) {
      const session = await createSession<Registry>({
        root: process.cwd(),
        config: "unused",
        outDir: "unused",
        registry,
        watch: false,
      });
      let content = session.content;
      if (backend === "encoded") {
        const revision = sessionInternals(session as never).state.revision!;
        const collections: Record<string, EncodedCollection> = {};
        for (const [name, collection] of Object.entries(revision.collections)) {
          collections[name] = {
            records: collection.records.map(encode),
            builtins: Object.fromEntries(
              [...collection.builtins].map(([id, load]) => [
                id,
                async () => ({ default: encode(await load()) }),
              ]),
            ),
          };
        }
        content = createArtifactRuntime<Registry>(
          { version: ARTIFACT_VERSION, codec: CODEC_VERSION, collections: revision.registry },
          collections,
        );
      }
      return { content, session };
    }
    /** Prepares the shared conformance fixture. */
    function setup() {
      return prepared(fixture());
    }
    test("projects only selected fields, preserving own undefined and query immutability", async () => {
      const { content, session } = await setup();
      const base = content.select().from("posts");
      const first = base
        .where((fields) => eq(fields.id, "first"))
        .select("id", "optional", "upper");
      const second = base.where((fields) => eq(fields.id, "second")).select("title");
      expect(await first.first()).toEqual({ id: "first", optional: undefined, upper: "ALPHA%_" });
      expect(Object.hasOwn((await first.first())!, "optional")).toBe(true);
      expect(await second.all()).toEqual([{ title: "Beta" }]);
      expect(await base.count()).toBe(3);
      await session.dispose();
    });
    test("uses strict predicates and distinguishes missing, undefined, and null", async () => {
      const { content } = await setup();
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => isMissing(fields.optional))
          .count(),
      ).toBe(1);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => isUndefined(fields.optional))
          .count(),
      ).toBe(2);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => isNull(fields.optional))
          .count(),
      ).toBe(1);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => contains(fields.title, "%_"))
          .count(),
      ).toBe(1);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => and(gt(fields.score, 1), not(eq(fields.score, NaN))))
          .count(),
      ).toBe(1);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => inArray(fields.id, []))
          .count(),
      ).toBe(0);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => notInArray(fields.id, []))
          .count(),
      ).toBe(3);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => or(arrayContains(fields.tags, "a"), arrayContainsAny(fields.tags, [])))
          .count(),
      ).toBe(1);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => arrayContainsAll(fields.tags, []))
          .count(),
      ).toBe(3);
      expect(
        await content
          .select()
          .from("posts")
          .where((fields) => eq(fields.date, new Date(NaN)))
          .count(),
      ).toBe(1);
    });
    test("sorts deterministically, pages after filtering, and counts before pagination", async () => {
      const { content } = await setup();
      const base = content.select("id").from("posts").orderBy("score", "desc");
      expect(await base.all()).toEqual([{ id: "second" }, { id: "first" }, { id: "third" }]);
      expect(await base.offset(1).limit(1).all()).toEqual([{ id: "first" }]);
      expect(await base.offset(100).limit(0).count()).toBe(3);
      expect(await base.limit(0).first()).toBeUndefined();
      expect(() => base.limit(-1)).toThrow(/safe integer/);
      expect(() => base.orderBy("score")).toThrow(/repeated sort/);
      expect(() => base.select("id")).toThrow(/once/);
    });
    test("loads forward/inverse relations with local filtering and per-parent pagination", async () => {
      const { content } = await setup();
      expect(
        await content
          .select("id")
          .from("posts")
          .with("author", (author) => author.select("name"))
          .all(),
      ).toEqual([
        { id: "first", author: { name: "Ada" } },
        { id: "second", author: { name: "Ada" } },
        { id: "third", author: null },
      ]);
      expect(
        await content
          .select("name")
          .from("authors")
          .with("posts", (posts) => posts.select("title").orderBy("score", "desc").limit(1))
          .all(),
      ).toEqual([
        { name: "Ada", posts: [{ title: "Beta" }] },
        { name: "Grace", posts: [] },
      ]);
      expect(
        await content
          .select("id")
          .from("posts")
          .with("author", (author) =>
            author.select("name").where((fields) => eq(fields.name, "nobody")),
          )
          .first(),
      ).toEqual({ id: "first", author: null });
    });
    test("preserves forward-array order and duplicates, but inverse membership is distinct", async () => {
      const { content } = await setup();
      const result = await content
        .select("name")
        .from("authors")
        .with("featuredPosts", (posts) => posts.select("id"))
        .first();
      expect(result?.featuredPosts).toEqual([{ id: "second" }, { id: "first" }, { id: "second" }]);
      const sorted = await content
        .select("name")
        .from("authors")
        .with("featuredPosts", (posts) => posts.select("id").orderBy("id"))
        .first();
      expect(sorted?.featuredPosts).toEqual([{ id: "first" }, { id: "second" }, { id: "second" }]);
    });
    test("payloads load after paging, detached, with distinct absence and errors", async () => {
      const { content } = await setup();
      const post = await content.query.posts.findFirst({
        where: { id: "first" },
        columns: { title: true },
        payloads: { _body: true, _rendered: true },
      });
      expect(post).toEqual({
        title: "Alpha%_",
        _payloads: {
          _body: "raw",
          _rendered: {
            html: '<h2 id="hello">Hello</h2>',
            headings: [{ depth: 2, slug: "hello", text: "Hello" }],
          },
        },
      });
      post!._payloads._rendered.headings[0]!.text = "Changed";
      const fluent = await content
        .select("id")
        .from("posts")
        .where((fields) => eq(fields.id, "first"))
        .withPayload("_rendered")
        .withPayload("_body")
        .first();
      expect(fluent).toEqual({
        id: "first",
        _payloads: {
          _rendered: {
            html: '<h2 id="hello">Hello</h2>',
            headings: [{ depth: 2, slug: "hello", text: "Hello" }],
          },
          _body: "raw",
        },
      });
      expect(
        await content.query.authors.findFirst({
          where: { id: "ada" },
          columns: {},
          payloads: { _body: true },
        }),
      ).toEqual({ _payloads: { _body: undefined } });
      expect(
        await content.query.posts.findMany({
          columns: { id: true },
          orderBy: { id: "asc" },
          offset: 1,
          limit: 1,
          payloads: { _body: true, _rendered: false },
        }),
      ).toEqual([{ id: "second", _payloads: { _body: undefined } }]);
      expect(
        await content.query.posts.findMany({ columns: { id: true }, payloads: { _body: false } }),
      ).toEqual([{ id: "first" }, { id: "second" }, { id: "third" }]);
      await expect(
        content.query.authors.findMany({ payloads: { _rendered: true } }),
      ).rejects.toMatchObject({ code: "not-renderable" });
      expect(() => content.query.posts.findMany({ payloads: { missing: true } as never })).toThrow(
        /Unknown payload "missing"/,
      );
      expect(() => content.query.posts.findMany({ payloads: { _body: "yes" } as never })).toThrow(
        /requires exactly these string variant keys: none/,
      );
      await expect(
        content.count("posts", { payloads: { _body: true } } as never),
      ).rejects.toMatchObject({ code: "invalid-query" });
      const counted = content.select("id").from("posts").withPayload("_body") as unknown as {
        count(): Promise<number>;
      };
      await expect(counted.count()).rejects.toMatchObject({ code: "invalid-query" });
      expect(() =>
        content
          .select("id")
          .from("posts")
          .withPayload("_body")
          .withPayload("_body" as never),
      ).toThrow(/cannot be repeated/);
    });
    test("payloads never reach adjacent rows, and shared related rows get their own copies", async () => {
      const { content } = await setup();
      expect(
        await content.query.posts.findMany({
          columns: { id: true },
          adjacent: true,
          payloads: { _body: true },
          limit: 1,
        }),
      ).toEqual([
        {
          id: "first",
          _adjacent: { previous: null, next: { id: "second" } },
          _payloads: { _body: "raw" },
        },
      ]);
      expect(
        await content.query.posts.findFirst({
          where: { id: "second" },
          columns: { id: true },
          adjacent: { orderBy: { id: "asc" }, columns: { id: true } },
          payloads: { _body: true },
        }),
      ).toEqual({
        id: "second",
        _adjacent: { previous: { id: "first" }, next: { id: "third" } },
        _payloads: { _body: undefined },
      });
      const author = await content.query.authors.findFirst({
        where: { id: "ada" },
        columns: {},
        with: { featuredPosts: { columns: { id: true }, payloads: { _body: true } } },
      });
      expect(author?.featuredPosts).toEqual([
        { id: "second", _payloads: { _body: undefined } },
        { id: "first", _payloads: { _body: "raw" } },
        { id: "second", _payloads: { _body: undefined } },
      ]);
      expect(author!.featuredPosts[0]!._payloads).not.toBe(author!.featuredPosts[2]!._payloads);
      const pages = {
        pages: defineCollection({
          loader: fixtureLoader(() => [
            {
              id: "home",
              data: {},
              rendered: {
                html: "<h1>Home</h1>",
                metadata: { headings: [{ depth: 1, slug: "home", text: "Home" }] },
              },
            },
          ]),
          schema: z.object({}),
        }),
        notes: defineCollection({
          loader: fixtureLoader(() => [
            { id: "a", data: { pageId: "home" } },
            { id: "b", data: { pageId: "home" } },
          ]),
          schema: z.object({ pageId: z.string() }),
          relationships: {
            page: {
              collection: "pages",
              type: "one",
              from: "pageId",
              to: "id",
              referenceSide: "from",
            },
          },
        }),
      };
      const shared = await prepared(pages);
      const notes = await shared.content.query.notes.findMany({
        columns: { id: true },
        with: { page: { columns: {}, payloads: { _rendered: true } } },
      });
      notes[0]!.page._payloads._rendered.headings[0]!.text = "Changed";
      expect(notes[1]!.page._payloads._rendered.headings[0]!.text).toBe("Home");
      await shared.session.dispose();
    });
  });
}

describe("prepared values and errors", () => {
  test("selects prototype-like missing names as own undefined values", async () => {
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        schema: z.object({}),
      }),
    };
    const session = await createSession<typeof registry>({
      root: ".",
      config: "unused",
      outDir: "unused",
      watch: false,
      registry,
    });
    const selected = await session.content
      .select("__proto__" as "id")
      .from("values")
      .first();
    expect(Object.hasOwn(selected!, "__proto__")).toBe(true);
    expect(Reflect.get(selected!, "__proto__")).toBeUndefined();
    await session.dispose();
  });
  test("rejects unsupported stored shapes and contextualizes processing failures", async () => {
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [
          { id: "one", data: { value: Object.fromEntries([["__proto__", "unsupported"]]) } },
        ]),
        schema: z.object({ value: z.unknown() }),
      }),
    };
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", registry, watch: false }),
    ).rejects.toMatchObject({ code: "validation-error", id: "one", collection: "values" });
    const nested = {
      values: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: { nested: { list: [1, () => 2] } } }]),
        schema: z.object({ nested: z.unknown() }),
      }),
    };
    await expect(
      createSession({
        root: ".",
        config: "unused",
        outDir: "unused",
        registry: nested,
        watch: false,
      }),
    ).rejects.toMatchObject({
      code: "validation-error",
      path: ["nested", "list", 1],
      message: expect.stringContaining("(at .nested.list[1])"),
    });
    const broken = {
      values: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        schema: z.object({}),
        computed: {
          first: {
            schema: z.string(),
            resolve: () => {
              throw new Error("resolver failed");
            },
          },
          second: { schema: z.string(), resolve: async () => 2 },
        },
      }),
    };
    await expect(
      createSession({
        root: ".",
        config: "unused",
        outDir: "unused",
        registry: broken,
        watch: false,
      }),
    ).rejects.toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ path: ["first"], cause: expect.any(Error) }),
        expect.objectContaining({ path: ["second"], issues: expect.any(Array) }),
      ]),
    });
  });
  test("distinguishes artifact corruption from deferred compiler failures", async () => {
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: {} }]),
        schema: z.object({}),
      }),
    };
    const session = await createSession<typeof registry>({
      root: ".",
      config: "unused",
      outDir: "unused",
      registry,
      watch: false,
    });
    const revision = sessionInternals(session).state.revision!;
    revision.collections.values!.builtins = new Map([["one", async () => ({ body: 2 }) as never]]);
    await expect(
      session.content.query.values.findMany({ payloads: { _body: true } }),
    ).rejects.toMatchObject({
      code: "artifact-error",
      cause: expect.any(Error),
    });
    revision.collections.values!.builtins = new Map([["one", async () => ({ markdown: "input" })]]);
    revision.renderMarkdown = async () => {
      throw new Error("compiler failed");
    };
    await expect(
      session.content.query.values.findMany({ payloads: { _rendered: true } }),
    ).rejects.toMatchObject({
      code: "render-error",
      cause: expect.any(Error),
    });
    await session.dispose();
  });
  test("preserves supported graphs and isolates selected mutable values", async () => {
    const shared: Record<string, unknown> = {
      date: new Date(0),
      map: new Map([["key", 1]]),
      set: new Set([1]),
      bytes: new Uint8Array([1, 2]),
      url: new URL("https://example.com"),
      params: new URLSearchParams("a=1"),
      hole: Object.assign([], { length: 2, 1: undefined }),
      big: 2n ** 80n,
    };
    shared.self = shared;
    const registry = {
      values: defineCollection({
        loader: fixtureLoader(() => [{ id: "one", data: { left: shared, right: shared } }]),
        schema: z.object({ left: z.unknown(), right: z.unknown() }),
      }),
    };
    const session = await createSession<typeof registry>({
      root: ".",
      config: "unused",
      outDir: "unused",
      watch: false,
      registry,
    });
    const result = (await session.content.select("left", "right").from("values").first())! as {
      left: typeof shared;
      right: typeof shared;
    };
    expect(result.left).toBe(result.right);
    expect(result.left.self).toBe(result.left);
    expect(0 in (result.left.hole as unknown[])).toBe(false);
    (result.left.date as Date).setTime(900);
    (result.left.bytes as Uint8Array)[0] = 9;
    const again = (await session.content.select("left").from("values").first())!
      .left as typeof shared;
    expect((again.date as Date).getTime()).toBe(0);
    expect((again.bytes as Uint8Array)[0]).toBe(1);
  });
  test("reports independent errors without running computed fields on invalid metadata", async () => {
    let computedCalls = 0;
    const registry = {
      broken: defineCollection({
        loader: fixtureLoader(() => [
          { id: "one", data: { name: 1 } },
          { id: "two", data: { name: false } },
        ]),
        schema: z.object({ name: z.string() }),
        computed: {
          upper: {
            schema: z.string(),
            resolve: ({ data }) => {
              computedCalls++;
              return data.name;
            },
          },
        },
      }),
    };
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", watch: false, registry }),
    ).rejects.toMatchObject({
      code: "validation-error",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ id: "one", issues: expect.any(Array) }),
        expect.objectContaining({ id: "two" }),
      ]),
    });
    expect(computedCalls).toBe(0);
  });
  test("rejects duplicate IDs and dangling references before publishing", async () => {
    const duplicate = {
      values: defineCollection({
        loader: fixtureLoader(() => [
          { id: "same", data: {} },
          { id: "same", data: {} },
        ]),
        schema: z.object({}),
      }),
    };
    await expect(
      createSession({
        root: ".",
        config: "unused",
        outDir: "unused",
        watch: false,
        registry: duplicate,
      }),
    ).rejects.toMatchObject({ code: "duplicate-id" });
    const registry = fixture();
    registry.authors.loader = fixtureLoader(() => []);
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", watch: false, registry }),
    ).rejects.toMatchObject({ code: "invalid-reference" });
  });
  test("reports every invalid reference without speculating about failed collections", async () => {
    const registry = {
      authors: defineCollection({
        loader: fixtureLoader(() => [
          { id: "ada", data: { handle: "ada" } },
          { id: "twin-a", data: { handle: "twin" } },
          { id: "twin-b", data: { handle: "twin" } },
        ]),
        schema: z.object({ handle: z.string() }),
      }),
      posts: defineCollection({
        loader: fixtureLoader(() => [
          { id: "one", data: { authorHandle: "missing", tags: ["x", "gone", "gone"] } },
          { id: "two", data: { authorHandle: "twin", tags: [] } },
          { id: "three", data: { authorHandle: "ada", tags: ["x"] } },
        ]),
        schema: z.object({ authorHandle: z.string(), tags: z.array(z.string()) }),
        relationships: {
          author: {
            collection: "authors",
            type: "one",
            from: "authorHandle",
            to: "handle",
            referenceSide: "from",
          },
          tagged: {
            collection: "tags",
            type: "many",
            from: "tags",
            to: "id",
            referenceSide: "from",
          },
        },
      }),
      tags: defineCollection({
        loader: fixtureLoader(() => [{ id: "x", data: {} }]),
        schema: z.object({}),
      }),
      broken: defineCollection({
        loader: fixtureLoader(() => [{ id: "bad", data: { name: 1 } }]),
        schema: z.object({ name: z.string() }),
      }),
      comments: defineCollection({
        loader: fixtureLoader(() => [{ id: "c", data: { brokenId: "bad" } }]),
        schema: z.object({ brokenId: z.string() }),
        relationships: {
          subject: {
            collection: "broken",
            type: "one",
            from: "brokenId",
            to: "id",
            referenceSide: "from",
          },
        },
      }),
    };
    const failure = await createSession({
      root: ".",
      config: "unused",
      outDir: "unused",
      registry,
      watch: false,
    }).catch((error: unknown) => error as ContentError);
    expect(failure).toBeInstanceOf(ContentError);
    const diagnostics = (failure as ContentError).diagnostics.map(
      ({ code, collection, id, path, message }) => ({ code, collection, id, path, message }),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: "validation-error", collection: "broken", id: "bad" }),
      {
        code: "invalid-reference",
        collection: "posts",
        id: "one",
        path: ["authorHandle"],
        message:
          'Invalid relationship posts.author: Reference "missing" has no target in "authors".',
      },
      {
        code: "invalid-reference",
        collection: "posts",
        id: "two",
        path: ["authorHandle"],
        message:
          'Invalid relationship posts.author: Reference "twin" matches 2 entries in "authors".',
      },
      {
        code: "invalid-reference",
        collection: "posts",
        id: "one",
        path: ["tags"],
        message: 'Invalid relationship posts.tagged: Reference "gone" has no target in "tags".',
      },
    ]);
  });
  test("describes typed references, invalid declarations, and inverse cardinality", async () => {
    const registry = {
      targets: defineCollection({
        loader: fixtureLoader(() => [
          { id: "t1", data: { n: 1, big: 1n, when: new Date(0), owner: "r", tags: ["a"] } },
          { id: "t2", data: { n: 2, big: 2n, when: new Date(1), owner: "r", tags: ["b"] } },
        ]),
        schema: z.object({
          n: z.number(),
          big: z.bigint(),
          when: z.date(),
          owner: z.string(),
          tags: z.array(z.string()),
        }),
      }),
      refs: defineCollection({
        loader: fixtureLoader(() => [
          {
            id: "r",
            data: {
              num: 404,
              big: 5n,
              when: new Date("2026-01-01T00:00:00.000Z"),
              obj: { nested: true },
              list: ["a"],
            },
          },
        ]),
        schema: z.object({
          num: z.number(),
          big: z.bigint(),
          when: z.date(),
          obj: z.unknown(),
          list: z.array(z.string()),
        }),
        relationships: {
          byNumber: {
            collection: "targets",
            type: "one",
            from: "num",
            to: "n",
            referenceSide: "from",
          },
          byBig: {
            collection: "targets",
            type: "one",
            from: "big",
            to: "big",
            referenceSide: "from",
          },
          byDate: {
            collection: "targets",
            type: "one",
            from: "when",
            to: "when",
            referenceSide: "from",
          },
          byObject: {
            collection: "targets",
            type: "many",
            from: "obj",
            to: "n",
            referenceSide: "none",
          },
          byArrays: {
            collection: "targets",
            type: "many",
            from: "list",
            to: "tags",
            referenceSide: "none",
          },
          unregistered: {
            collection: "missing",
            type: "one",
            from: "num",
            to: "id",
            referenceSide: "from",
          },
          owned: {
            collection: "targets",
            type: "one",
            from: "id",
            to: "owner",
            referenceSide: "to",
          },
        },
      }),
    };
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", registry, watch: false }),
    ).rejects.toMatchObject({
      code: "invalid-reference",
      diagnostics: [
        expect.objectContaining({
          message: expect.stringContaining('Reference 404 has no target in "targets".'),
        }),
        expect.objectContaining({ message: expect.stringContaining("Reference 5n has no target") }),
        expect.objectContaining({
          message: expect.stringContaining("Reference 2026-01-01T00:00:00.000Z has no target"),
        }),
        expect.objectContaining({ message: expect.stringContaining("must be scalars") }),
        expect.objectContaining({ message: expect.stringContaining("Array-to-array") }),
        expect.objectContaining({ message: expect.stringContaining("unregistered target") }),
        expect.objectContaining({
          collection: "refs",
          id: "r",
          message: expect.stringContaining(
            "refs.owned: A singular relationship has 2 unfiltered matches.",
          ),
        }),
      ],
    });
  });
  test("validates inverse-only ownership and reports the owning entry's source", async () => {
    const registry = {
      authors: defineCollection({
        loader: fixtureLoader(() => [{ id: "ada", data: {} }]),
        schema: z.object({}),
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
          { id: "post", data: { authorId: "missing" }, source: "post.md" },
        ]),
        schema: z.object({ authorId: z.string() }),
      }),
    };
    await expect(
      createSession({ root: ".", config: "unused", outDir: "unused", registry, watch: false }),
    ).rejects.toMatchObject({
      code: "invalid-reference",
      collection: "posts",
      id: "post",
      path: ["authorId"],
      source: path.resolve("post.md"),
    });
  });
});

/** Runs a synchronous action that must throw and returns what it threw. */
function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw.");
}

/** Widens a style-restricted runtime so tests can reach its disabled members. */
function unrestricted(content: unknown): Content<ReturnType<typeof fixture>> {
  return content as Content<ReturnType<typeof fixture>>;
}

describe("query style gating", () => {
  /** Prepares the shared fixture in a session that allows only one query style. */
  function styledSession<Style extends QueryStyle>(queryStyle: Style) {
    const registry = fixture();
    return createSession<typeof registry, Style>({
      root: process.cwd(),
      config: "unused",
      outDir: "unused",
      registry,
      watch: false,
      queryStyle,
    });
  }

  test("relational style rejects fluent queries but keeps relational queries and counts", async () => {
    const session = await styledSession("relational");
    try {
      const content = unrestricted(session.content);
      expect(thrownBy(() => content.select("id"))).toMatchObject({
        code: "invalid-query",
        message:
          'content.select is unavailable because content-query.config sets queryStyle to "relational".',
      });
      expect(
        await session.content.query.posts.findMany({ columns: { id: true }, limit: 1 }),
      ).toEqual([{ id: "first" }]);
      expect(await session.content.count("posts")).toBe(3);
    } finally {
      await session.dispose();
    }
  });

  test("fluent style rejects relational access and counts but keeps fluent queries", async () => {
    const session = await styledSession("fluent");
    try {
      const content = unrestricted(session.content);
      expect(thrownBy(() => content.query)).toMatchObject({
        code: "invalid-query",
        message:
          'content.query is unavailable because content-query.config sets queryStyle to "fluent".',
      });
      expect(thrownBy(() => content.count("posts"))).toMatchObject({
        code: "invalid-query",
        message:
          'content.count is unavailable because content-query.config sets queryStyle to "fluent".',
      });
      expect(await session.content.select("id").from("posts").count()).toBe(3);
      expect(
        await session.content
          .select("id")
          .from("posts")
          .with("author", (author) => author.select("name"))
          .first(),
      ).toEqual({ id: "first", author: { name: "Ada" } });
    } finally {
      await session.dispose();
    }
  });

  test("sessions without a style allow both query APIs", async () => {
    const registry = fixture();
    const session = await createSession<typeof registry>({
      root: process.cwd(),
      config: "unused",
      outDir: "unused",
      registry,
      watch: false,
    });
    try {
      expect(await session.content.select("id").from("posts").count()).toBe(3);
      expect(await session.content.count("posts")).toBe(3);
      expect(await session.content.query.posts.findFirst({ columns: { id: true } })).toEqual({
        id: "first",
      });
    } finally {
      await session.dispose();
    }
  });

  /** Encodes a styled session's revision as the generated modules would. */
  async function encodedRevision(queryStyle: QueryStyle) {
    const session = await styledSession(queryStyle);
    try {
      const revision = sessionInternals(session as never).state.revision!;
      return {
        queryStyle: revision.queryStyle,
        manifest: {
          version: ARTIFACT_VERSION,
          codec: CODEC_VERSION,
          collections: revision.registry,
        },
        collections: Object.fromEntries(
          Object.entries(revision.collections).map(([name, collection]) => [
            name,
            { records: collection.records.map(encode), builtins: {} },
          ]),
        ),
      };
    } finally {
      await session.dispose();
    }
  }

  test("artifact runtimes enforce the style carried by the manifest", async () => {
    const encoded = await encodedRevision("relational");
    expect(encoded.queryStyle).toBe("relational");
    const content = unrestricted(
      createArtifactRuntime<ReturnType<typeof fixture>>(
        { ...encoded.manifest, queryStyle: "relational" },
        encoded.collections,
      ),
    );
    expect(thrownBy(() => content.select("id"))).toMatchObject({ code: "invalid-query" });
    expect(await content.count("posts")).toBe(3);
    expect(await content.query.posts.findFirst({ columns: { id: true } })).toEqual({
      id: "first",
    });
  });

  test("artifact runtimes reject an unknown manifest style", async () => {
    const encoded = await encodedRevision("fluent");
    expect(
      thrownBy(() =>
        createArtifactRuntime(
          { ...encoded.manifest, queryStyle: "sql" as QueryStyle },
          encoded.collections,
        ),
      ),
    ).toMatchObject({
      code: "artifact-error",
      cause: { message: "Invalid query style in content artifact; regenerate content." },
    });
  });
});

/** Type-only consumer checks: invalid calls must fail without weakening result inference. */
function checkTypes(content: Content<ReturnType<typeof fixture>>) {
  // @ts-expect-error Registered collection names are required.
  content.select().from("missing");
  void content.select().from("posts").all();
  // @ts-expect-error Field names come from schema outputs and computed fields.
  content.select("typo").from("posts");
  content
    .select()
    .from("posts")
    // @ts-expect-error String predicates are unavailable for numeric fields.
    .where((fields) => contains(fields.score, "2"));
  content
    .select()
    .from("posts")
    // @ts-expect-error Operator arguments retain their field type.
    .where((fields) => eq(fields.score, "2"));
  const selected = content.select("id").from("posts");
  // @ts-expect-error Nested relationships need their own selection.
  selected.with("author", (author) => author);
  // @ts-expect-error Singular builders have no pagination.
  selected.with("author", (author) => author.select("name").limit(1));
}
void checkTypes;

/** Type-only checks: `Style` removes the other style's root members without widening results. */
function checkQueryStyleTypes(
  relational: Content<ReturnType<typeof fixture>, "relational">,
  fluent: Content<ReturnType<typeof fixture>, "fluent">,
  session: ContentSession<ReturnType<typeof fixture>, "relational">,
) {
  void relational.query.posts.findMany({ columns: { title: true } });
  void relational.count("posts");
  // @ts-expect-error A relational-only content export has no fluent root.
  relational.select("id");
  // @ts-expect-error The message type also rejects calls without arguments.
  relational.select();
  void fluent.select("title").from("posts").count();
  // @ts-expect-error A fluent-only content export has no relational namespace.
  void fluent.query.posts;
  // @ts-expect-error Counting by collection name is relational.
  void fluent.count("posts");
  const titles: Promise<{ title: string }[]> = fluent.select("title").from("posts").all();
  void titles;
  // Restricted sessions stay assignable to sessions with a wider registry.
  const wide: ContentSession<{}, "relational"> = session;
  void wide;
}
void checkQueryStyleTypes;
