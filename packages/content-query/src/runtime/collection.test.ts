import { describe, expect, test } from "vite-plus/test";
import { defineCollection } from "../collection/define.ts";
import { schema } from "../schema.ts";
import { fixtureLoader } from "../../tests/helpers/loader.ts";
import { createSession, sessionInternals } from "../preparation/session.ts";
import { createArtifactCollection } from "../internal.ts";
import { ARTIFACT_VERSION, CODEC_VERSION } from "../artifacts/types.ts";
import { encode } from "../shared/values.ts";
import { ContentError } from "../shared/errors.ts";
import { eq, has } from "../query.ts";
import type { CollectionHandles } from "../runtime.ts";
import { createCollection, createCollections } from "./collection.ts";

/** Defines three related collections, so nested relationships cross two hops. */
function definitions() {
  return {
    authors: defineCollection({
      loader: fixtureLoader(() => [
        { id: "ada", data: { name: "Ada", publisherId: "acme" } },
        { id: "grace", data: { name: "Grace" } },
      ]),
      schema: schema.object({ name: schema.string(), publisherId: schema.string().optional() }),
      relationships: {
        posts: {
          collection: "posts",
          type: "many",
          from: "id",
          to: "authorId",
          referenceSide: "to",
        },
        publisher: {
          collection: "publishers",
          type: "one",
          from: "publisherId",
          to: "id",
          referenceSide: "from",
        },
      },
    }),
    posts: defineCollection({
      loader: fixtureLoader(() => [
        { id: "a", data: { title: "Alpha", draft: false, authorId: "ada" } },
        { id: "b", data: { title: "Beta", draft: true, authorId: "grace" } },
        { id: "c", data: { title: "Gamma", draft: false } },
      ]),
      schema: schema.object({
        title: schema.string(),
        draft: schema.boolean(),
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
    publishers: defineCollection({
      loader: fixtureLoader(() => [{ id: "acme", data: { name: "Acme" } }]),
      schema: schema.object({ name: schema.string() }),
    }),
  };
}
type Registry = ReturnType<typeof definitions>;
type Handles = CollectionHandles<Registry>;

/**
 * Creates handles from one in-memory session, or from separately initialized generated entries,
 * one per collection, as `#content-query/<name>` imports them.
 */
async function setup(entries: boolean) {
  const registry = definitions();
  const session = await createSession<Registry>({
    root: ".",
    config: "unused",
    outDir: "unused",
    watch: false,
    registry,
  });
  let collections: Handles = session.collections;
  if (entries) {
    const revision = sessionInternals(session).state.revision!;
    collections = Object.fromEntries(
      Object.entries(revision.collections).map(([name, collection]) => [
        name,
        createArtifactCollection(
          {
            version: ARTIFACT_VERSION,
            codec: CODEC_VERSION,
            collections: { [name]: revision.registry[name]! },
          },
          name as Extract<keyof Registry, string>,
          { records: collection.records.map(encode), builtins: {} },
        ),
      ]),
    ) as Handles;
  }
  return { ...collections, session };
}

for (const entries of [false, true]) {
  describe(`collection handles, entries=${entries}`, () => {
    test("queries its own collection without any other collection", async () => {
      const { posts, session } = await setup(entries);
      try {
        expect(
          await posts
            .select("id")
            .where((fields) => eq(fields.draft, false))
            .all(),
        ).toEqual([{ id: "a" }, { id: "c" }]);
        expect(await posts.findMany({ columns: { title: true }, where: { draft: true } })).toEqual([
          { title: "Beta" },
        ]);
        expect(
          await posts.findFirst({ columns: { id: true }, orderBy: { title: "desc" } }),
        ).toEqual({ id: "c" });
        expect(await posts.count()).toBe(3);
        expect(await posts.count({ where: { draft: false } })).toBe(2);
        expect(await posts.where((fields) => eq(fields.draft, true)).count()).toBe(1);
        expect(
          (
            await posts.paginate({
              columns: { id: true },
              orderBy: { id: "asc" },
              page: 2,
              size: 2,
            })
          ).items,
        ).toEqual([{ id: "c" }]);
      } finally {
        await session.dispose();
      }
    });

    test("rejects relationships into collections it has not loaded, naming the one to supply", async () => {
      const { posts, session } = await setup(entries);
      const message =
        /Relationship "author" targets the authors collection.*posts\.using\(authors\)/;
      try {
        expect(() =>
          posts.findMany({
            columns: { id: true },
            // @ts-expect-error The authors collection was not supplied.
            with: { author: { columns: { name: true } } },
          }),
        ).toThrow(message);
        expect(() =>
          // @ts-expect-error The authors collection was not supplied.
          posts.findMany({ columns: { id: true }, where: { author: { name: "Ada" } } }),
        ).toThrow(message);
        expect(() =>
          // @ts-expect-error The authors collection was not supplied.
          posts.select("id").with("author", (author) => author.select("name")),
        ).toThrow(message);
        // @ts-expect-error The authors collection was not supplied.
        expect(() => posts.where((fields) => has(fields.author))).toThrow(message);
        expect(() => posts.select("author" as "title")).toThrow(message);
      } finally {
        await session.dispose();
      }
    });

    test("follows relationships into supplied collections", async () => {
      const { posts, authors, session } = await setup(entries);
      try {
        const related = posts.using(authors);
        const rows = await related.findMany({
          columns: { title: true },
          where: { author: { name: "Ada" } },
          with: { author: { columns: { name: true } } },
        });
        const name: string | undefined = rows[0]?.author?.name;
        expect(name).toBe("Ada");
        expect(rows).toEqual([{ title: "Alpha", author: { name: "Ada" } }]);
        expect(
          await related
            .select("id")
            .where((fields) => has(fields.author, (author) => eq(author.name, "Grace")))
            .with("author", (author) => author.select("name"))
            .all(),
        ).toEqual([{ id: "b", author: { name: "Grace" } }]);
        expect(await related.count({ where: { author: true } })).toBe(2);
        expect(
          await authors
            .using(posts)
            .findMany({ columns: { id: true }, with: { posts: { columns: { id: true } } } }),
        ).toEqual([
          { id: "ada", posts: [{ id: "a" }] },
          { id: "grace", posts: [{ id: "b" }] },
        ]);
      } finally {
        await session.dispose();
      }
    });

    test("requires every collection that a nested relationship reaches", async () => {
      const { posts, authors, publishers, session } = await setup(entries);
      try {
        expect(() =>
          posts.using(authors).findMany({
            columns: { id: true },
            with: {
              author: {
                columns: { name: true },
                // @ts-expect-error The publishers collection was not supplied.
                with: { publisher: { columns: { name: true } } },
              },
            },
          }),
        ).toThrow(/Relationship "publisher" targets the publishers collection/);
        const options = {
          columns: { id: true },
          where: { id: "a" },
          with: {
            author: { columns: { name: true }, with: { publisher: { columns: { name: true } } } },
          },
        } as const;
        const expected = [{ id: "a", author: { name: "Ada", publisher: { name: "Acme" } } }];
        expect(await posts.using(authors, publishers).findMany(options)).toEqual(expected);
        expect(await posts.using(publishers, authors).findMany(options)).toEqual(expected);
        expect(await posts.using(authors.using(publishers)).findMany(options)).toEqual(expected);
        expect(await posts.using(authors).using(publishers).findMany(options)).toEqual(expected);
      } finally {
        await session.dispose();
      }
    });

    test("accepts the queried collection and repeated collections, but nothing else", async () => {
      const { posts, authors, session } = await setup(entries);
      try {
        const handle = posts.using(posts, authors, authors);
        expect(
          await handle.findFirst({
            columns: { id: true },
            where: { id: "a" },
            with: { author: { columns: { id: true } } },
          }),
        ).toEqual({ id: "a", author: { id: "ada" } });
        // @ts-expect-error using() accepts collection handles only.
        expect(() => posts.using({})).toThrow(/using\(\) accepts collections/);
        expect("then" in posts).toBe(false);
      } finally {
        await session.dispose();
      }
    });
  });
}

describe("collection sources", () => {
  test("rejects two different copies of one collection", async () => {
    const first = await setup(true);
    const second = await setup(true);
    try {
      expect(() => first.posts.using(first.authors).using(second.authors)).toThrow(
        /two different copies of collection "authors"/,
      );
    } finally {
      await Promise.all([first.session.dispose(), second.session.dispose()]);
    }
  });

  test("builds queries while a state holds an error, then reports it when they run", async () => {
    const error = new ContentError({ code: "validation-error", message: "Invalid title" });
    const posts = createCollection({ name: "posts", state: { error } }) as Handles["posts"];
    await expect(posts.findMany({ columns: { id: true } })).rejects.toBe(error);
    await expect(posts.select("id").all()).rejects.toBe(error);
    await expect(posts.count()).rejects.toBe(error);
    const collections = createCollections({ error }) as Partial<Handles>;
    await expect(collections.posts!.count()).rejects.toBe(error);
  });

  test("reports a collection that a later revision removed", async () => {
    const { session } = await setup(false);
    try {
      const state = { revision: sessionInternals(session).state.revision };
      const posts = createCollection({ name: "posts", state }) as Handles["posts"];
      expect(await posts.count()).toBe(3);
      state.revision = { ...state.revision!, collections: {}, registry: {} };
      expect(() => posts.count()).toThrow(/Unknown collection "posts"/);
    } finally {
      await session.dispose();
    }
  });

  test("lists one live handle per collection in a session", async () => {
    const { session } = await setup(false);
    try {
      expect(Object.keys(session.collections)).toEqual(["authors", "posts", "publishers"]);
      expect(session.collections.posts).toBe(session.collections.posts);
      expect((session.collections as Record<string, unknown>).missing).toBeUndefined();
    } finally {
      await session.dispose();
    }
  });
});
