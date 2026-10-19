import { describe, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import { defineCollection } from "./define.ts";
import { buildContent } from "../build.ts";
import type { Content } from "../runtime.ts";
import { eq } from "../query.ts";

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
  const object = content.findMany("posts", {
    select: { subtitle: true, author: { select: { name: true } }, _adjacent: true },
  });
  expectTypeOf<Awaited<typeof object>>().toEqualTypeOf<
    {
      subtitle: string | undefined;
      author: { name: string };
      _adjacent: { previous: { id: string } | null; next: { id: string } | null };
    }[]
  >();
  const adjacent = content.query("posts").selectAdjacent((siblings) => siblings.select("subtitle"));
  expectTypeOf<Awaited<ReturnType<typeof adjacent.first>>>().toEqualTypeOf<
    | {
        _adjacent: {
          previous: { subtitle: string | undefined } | null;
          next: { subtitle: string | undefined } | null;
        };
      }
    | undefined
  >();
  // @ts-expect-error Object selection must reject unknown fields even alongside valid fields.
  void content.findMany("posts", { select: { id: true, typo: true } });
  // @ts-expect-error Object predicates must reject unknown fields alongside valid predicates.
  void content.findMany("posts", { where: { id: "a", typo: "b" }, select: { id: true } });
  // @ts-expect-error Object filters preserve scalar argument types.
  void content.findMany("posts", { where: { authorId: 1 }, select: { id: true } });
  // @ts-expect-error Object queries require explicit projection.
  void content.findMany("posts", { where: { id: "a" } });
  void content.findMany("posts", {
    // @ts-expect-error Recursive adjacency is prohibited in the object API.
    select: { _adjacent: { select: { id: true, _adjacent: true } } },
  });
  // @ts-expect-error Sibling queries have no pagination, including after chained clauses.
  content.query("posts").selectAdjacent((siblings) => siblings.orderBy("id").limit(1).select("id"));
  // @ts-expect-error Recursive adjacency is prohibited in the fluent API.
  content.query("posts").selectAdjacent((siblings) => siblings.selectAdjacent().select("id"));
  // @ts-expect-error Sources and loaders are mutually exclusive.
  defineCollection({ source: ".", loader });
  const selected = content.query("posts").select("subtitle");
  expectTypeOf<
    keyof Awaited<ReturnType<typeof selected.all>>[number]
  >().toEqualTypeOf<"subtitle">();
  expectTypeOf<Awaited<ReturnType<typeof selected.all>>[number]["subtitle"]>().toEqualTypeOf<
    string | undefined
  >();
  const required = content
    .query("posts")
    .select("id")
    .with("author", (author) => author.select("name"));
  expectTypeOf<Awaited<ReturnType<typeof required.all>>[number]["author"]>().toEqualTypeOf<{
    name: string;
  }>();
  const filtered = content
    .query("posts")
    .select("id")
    .with("author", (author) => author.select("name").where((fields) => eq(fields.name, "Ada")));
  expectTypeOf<Awaited<ReturnType<typeof filtered.all>>[number]["author"]>().toEqualTypeOf<{
    name: string;
  } | null>();
  // @ts-expect-error Complete-registry preparation checks target fields.
  void buildContent<typeof invalidRegistry>();
  // @ts-expect-error Generated/facade content cannot query an invalid registry.
  invalid.query("posts");
  const base = { loader, schema: z.object({ authorId: z.string() }) };
  const wrongFrom = {
    author: { collection: "authors", type: "one", from: "typo", to: "id", referenceSide: "from" },
  } as const;
  // @ts-expect-error The collection boundary already knows the source field names.
  defineCollection({ ...base, relationships: wrongFrom });
}
void check;

describe("public type contracts", () => {
  test("keeps an omitted source schema optional until preparation supplies loader defaults", () => {
    const inherited = defineCollection({ loader });
    expectTypeOf(inherited.schema).toEqualTypeOf<undefined>();
  });
  test("preserves inferred relationships and explicit optional-property selection", () => {
    expectTypeOf<Content<typeof registry>>().not.toBeAny();
  });
});
