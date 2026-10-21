import { describe, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "./define.ts";
import { buildContent } from "../build.ts";
import type { Content } from "../runtime.ts";
import { eq } from "../query.ts";
import {
  file,
  glob,
  type FileSource,
  type FileEntrySource,
  type Loader,
  type LoaderSource,
} from "../loaders.ts";
import type { Loader as AstroLoader, LoaderContext as AstroContext } from "astro/loaders";

const loader = { name: "fixture", async load() {} };
const authors = defineCollection({ loader, schema: z.object({ name: z.string() }) });
const posts = defineCollection({
  loader,
  schema: z.object({ authorId: z.string(), subtitle: z.string().optional() }),
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
const registry = { authors, posts };
const badTarget = defineCollection({
  loader,
  schema: z.object({ authorId: z.string() }),
  relationships: {
    author: {
      collection: "authors",
      type: "one",
      from: "authorId",
      to: "typo",
      referenceSide: "from",
    },
  },
});
const invalidRegistry = { authors, posts: badTarget };

/** Verifies the public inference boundary without executing preparation or invalid calls. */
function check(content: Content<typeof registry>, invalid: Content<typeof invalidRegistry>) {
  const object = content.query.posts.findMany({
    adjacent: true,
    columns: { subtitle: true },
    with: { author: { columns: { name: true } } },
  });
  expectTypeOf<Awaited<typeof object>>().toEqualTypeOf<
    {
      subtitle: string | undefined;
      author: { name: string };
      _adjacent: { previous: { id: string } | null; next: { id: string } | null };
    }[]
  >();
  const adjacent = content
    .select("id")
    .from("posts")
    .selectAdjacent((siblings) => siblings.select("subtitle"));
  expectTypeOf<Awaited<ReturnType<typeof adjacent.first>>>().toEqualTypeOf<
    | {
        id: string;
        _adjacent: {
          previous: { subtitle: string | undefined } | null;
          next: { subtitle: string | undefined } | null;
        };
      }
    | undefined
  >();
  // @ts-expect-error Object selection must reject unknown fields even alongside valid fields.
  void content.query.posts.findMany({ columns: { id: true, typo: true } });
  // @ts-expect-error Object predicates must reject unknown fields alongside valid predicates.
  void content.query.posts.findMany({ where: { id: "a", typo: "b" }, columns: { id: true } });
  // @ts-expect-error Object filters preserve scalar argument types.
  void content.query.posts.findMany({ where: { authorId: 1 }, columns: { id: true } });
  void content.query.posts.findMany({ where: { id: "a" } });
  void content.query.posts.findMany({
    // @ts-expect-error Adjacency cannot recurse through sibling scopes.
    adjacent: { adjacent: true, columns: { id: true } },
    columns: {},
  });
  content
    .select()
    .from("posts")
    // @ts-expect-error Sibling queries have no pagination, including after chained clauses.
    .selectAdjacent((siblings) => siblings.orderBy("id").limit(1).select("id"));
  content
    .select()
    .from("posts")
    // @ts-expect-error Recursive adjacency is prohibited in the fluent API.
    .selectAdjacent((siblings) => siblings.selectAdjacent().select("id"));
  // @ts-expect-error Sources and loaders are mutually exclusive.
  defineCollection({ source: ".", loader });
  const selected = content.select("subtitle").from("posts");
  expectTypeOf<
    keyof Awaited<ReturnType<typeof selected.all>>[number]
  >().toEqualTypeOf<"subtitle">();
  expectTypeOf<Awaited<ReturnType<typeof selected.all>>[number]["subtitle"]>().toEqualTypeOf<
    string | undefined
  >();
  const required = content
    .select("id")
    .from("posts")
    .with("author", (author) => author.select("name"));
  expectTypeOf<Awaited<ReturnType<typeof required.all>>[number]["author"]>().toEqualTypeOf<{
    name: string;
  }>();
  const filtered = content
    .select("id")
    .from("posts")
    .with("author", (author) => author.select("name").where((fields) => eq(fields.name, "Ada")));
  expectTypeOf<Awaited<ReturnType<typeof filtered.all>>[number]["author"]>().toEqualTypeOf<{
    name: string;
  } | null>();
  // @ts-expect-error Complete-registry preparation checks target fields.
  void buildContent<typeof invalidRegistry>();
  // @ts-expect-error Generated/facade content cannot query an invalid registry.
  invalid.select().from("posts");
  const base = { loader, schema: z.object({ authorId: z.string() }) };
  const wrongFrom = {
    author: { collection: "authors", type: "one", from: "typo", to: "id", referenceSide: "from" },
  } as const;
  // @ts-expect-error The collection boundary already knows the source field names.
  defineCollection({ ...base, relationships: wrongFrom });
}
void check;

/** Checks loader-specific inference and the unchanged Astro context without executing loaders. */
function checkSourceContracts(astroContext: AstroContext) {
  const cms: Loader<{ documentId: string; url: string }> = {
    name: "typed-cms",
    async load({ store }) {
      store.set({
        id: "one",
        data: { title: "Hello" },
        source: { documentId: "doc-one", url: "/one" },
      });
      // Astro-compatible entries may omit ContentQuery-specific metadata.
      store.set({ id: "missing", data: {} });
      // @ts-expect-error Source field values follow the loader's declared type.
      store.set({ id: "wrong", data: {}, source: { documentId: 1, url: "/one" } });
    },
  };
  const astroCompatible: AstroLoader = { name: cms.name, load: cms.load.bind(cms) };
  void astroCompatible;
  void cms.load(astroContext);
  expectTypeOf<LoaderSource<typeof cms>>().toEqualTypeOf<{ documentId: string; url: string }>();
  defineCollection({
    loader: cms,
    schema: z.object({ title: z.string() }),
    computed: {
      documentId: {
        schema: z.string(),
        resolve: ({ data, source }) => {
          expectTypeOf(data.title).toEqualTypeOf<string>();
          if (!source) {
            return data.title;
          }
          expectTypeOf(source.documentId).toEqualTypeOf<string>();
          // @ts-expect-error CMS source metadata does not acquire file fields.
          void source.filePath;
          // @ts-expect-error Resolver source metadata is readonly.
          source.documentId = "mutation";
          return source.documentId;
        },
      },
    },
  });
  defineCollection({
    loader: glob({ pattern: "*.md" }),
    computed: {
      sourceFile: {
        schema: z.string(),
        resolve: ({ source }) => {
          if (!source) {
            return "";
          }
          expectTypeOf(source).toEqualTypeOf<Readonly<FileSource>>();
          return source.filePath;
        },
      },
    },
  });
  defineCollection({
    loader: file("authors.json"),
    computed: {
      recordKey: {
        schema: z.string(),
        resolve: ({ source }) => {
          if (!source) {
            return "";
          }
          expectTypeOf(source).toEqualTypeOf<Readonly<FileEntrySource>>();
          return source.key;
        },
      },
    },
  });
  defineCollection({
    source: "./content/posts",
    computed: {
      sourceFile: {
        schema: z.string(),
        resolve: ({ source }) => {
          if (!source) {
            return "";
          }
          expectTypeOf(source.filePath).toEqualTypeOf<string>();
          return source.filePath;
        },
      },
    },
  });
  defineCollection({
    loader,
    computed: {
      unknownSource: {
        schema: z.unknown(),
        resolve: ({ source }) => {
          expectTypeOf(source).toEqualTypeOf<unknown>();
          // @ts-expect-error Untyped source metadata must be narrowed before accessing fields.
          void source.filePath;
          return source;
        },
      },
    },
  });
}
void checkSourceContracts;

describe("public type contracts", () => {
  test("keeps an omitted source schema optional until preparation supplies loader defaults", () => {
    const inherited = defineCollection({ loader });
    expectTypeOf(inherited.schema).toEqualTypeOf<undefined>();
  });
  test("preserves inferred relationships and explicit optional-property selection", () => {
    expectTypeOf<Content<typeof registry>>().not.toBeAny();
  });
});
